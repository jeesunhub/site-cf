const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// 1. Convert specific standard requires to Hono module syntax for Pages Functions
code = code.replace(/const express = require\('express'\);/g, "import { Hono } from 'hono';\nimport { cors } from 'hono/cors';\nimport { logger } from 'hono/logger';\nimport { handle } from 'hono/cloudflare-pages';");
code = code.replace(/const multer = require\('multer'\);/g, "// multer removed for R2");
code = code.replace(/const path = require\('path'\);/g, "// path omitted");
code = code.replace(/const fs = require\('fs'\);/g, "// fs omitted (serverless)");
code = code.replace(/const db = require\('\.\/db'\);/g, "import { initDb } from './db.mjs';\nimport { uploadToR2 } from './upload_helper.mjs';\nlet db; // will be initialized");
code = code.replace(/require\('dotenv'\)\.config\(\);/g, "");
code = code.replace(/const morgan = require\('morgan'\);/g, "");
code = code.replace(/const cors = require\('cors'\);/g, "");

// 2. Fix variable instantiations
code = code.replace(/const app = express\(\);/g, `
const _honoApp = new Hono();
_honoApp.use('*', logger());
_honoApp.use('*', cors());

const app = {
    get: (path, handler) => _honoApp.get(path, wrap(handler)),
    post: (path, handler) => _honoApp.post(path, wrap(handler)),
    put: (path, handler) => _honoApp.put(path, wrap(handler)),
    delete: (path, handler) => _honoApp.delete(path, wrap(handler)),
    use: (...args) => _honoApp.use(...args)
};

function wrap(handler) {
    return async (c) => {
        return new Promise(async (resolve) => {
             const originalJson = c.json.bind(c);
             c.json = (...args) => {
                 const response = originalJson(...args);
                 resolve(response);
                 return response;
             };
             const originalText = c.text.bind(c);
             c.text = (...args) => {
                 const response = originalText(...args);
                 resolve(response);
                 return response;
             };
             
             try {
                 const result = await handler(c);
                 if (result !== undefined) {
                     resolve(result);
                 }
             } catch (e) {
                 console.error('Route error:', e);
                 resolve(originalJson({error: e.message}, 500));
             }
        });
    };
}
`);

// Environment & FS fixes for Cloudflare
code = code.replace(/process\.env\.RENDER/g, "false");
code = code.replace(/process\.env/g, "c.env");
code = code.replace(/fs\.existsSync\(.*?\)/g, "false");
code = code.replace(/fs\.readFileSync\(.*?\)/g, "''");
code = code.replace(/fs\.mkdirSync\(.*?\)/g, "");

// Remove process.on and process.exit
code = code.replace(/process\.on\([\s\S]*?\}\);/g, "");
code = code.replace(/process\.exit\(1\);/g, "");

// Remove Multer configurations
code = code.replace(/const storage = multer\.diskStorage\(\{[\s\S]*?\}\);/g, "/* multer storage removed */");
code = code.replace(/const upload = multer\(\{ storage \}\);/g, "/* multer upload removed */");
code = code.replace(/if \(!fs\.existsSync\('\.\/uploads'\)\) \{[\s\S]*?\}/g, "/* mkdir sync removed */");

// Remove app.use static methods (Pages handles /public automatically)
code = code.replace(/app\.use\(express\.json\(\)\);/g, "");
code = code.replace(/app\.use\(morgan\('dev'\)\);/g, "");
code = code.replace(/app\.use\(cors\(\)\);/g, "");
code = code.replace(/app\.use\(express\.static.*/g, "");
code = code.replace(/app\.use\('\/uploads', express\.static.*/g, "");

// Mock req and res for Hono
const mockReqRes = `
  const req = {
    query: c.req.query(),
    params: c.req.param(),
    body: {}, 
    files: []
  };
  const res = {
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { return c.json(data, this.statusCode || 200); },
    download: function(path, filename) { return c.text('Download not supported on Workers', 501); }
  };
  req.body = await getBodySafely(c);
  req.files = c.req.rawFiles || [];
  req.file = req.files[0] || null;
  
  // Handle photos via R2 helper
  const uploadedUrls = [];
  if (req.files.length > 0) {
      for (const file of req.files) {
          const filename = await uploadToR2(file, c.env);
          if (filename) uploadedUrls.push('/uploads/' + filename);
      }
  }
`;

// Replace `app.METHOD(..., upload.X, (req, res) => {`
const routeRegex1 = /app\.(get|post|put|delete)\('([^']+)'\s*,\s*(?:upload\.\w+\(.*?\),\s*)?async\s*\(req,\s*res\)\s*=>\s*\{/g;
const routeRegex2 = /app\.(get|post|put|delete)\('([^']+)'\s*,\s*(?:upload\.\w+\(.*?\),\s*)?\(req,\s*res\)\s*=>\s*\{/g;

code = code.replace(routeRegex1, (match, method, route) => `app.${method}('${route}', async (c) => {${mockReqRes}`);
code = code.replace(routeRegex2, (match, method, route) => `app.${method}('${route}', async (c) => {${mockReqRes}`);

// Better replacement for image URL insertion handling spaces and template literals
code = code.replace(/`\/uploads\/\$\{file\.filename\}`/g, "(uploadedUrls[idx] || '/placeholder.png')");
code = code.replace(/`\/uploads\/\$\{req\.file\.filename\}`/g, "(uploadedUrls[0] || '/placeholder.png')");
code = code.replace(/\/uploads\/\$\{req\.file\.filename\}/g, "(uploadedUrls[0] || '/placeholder.png')");
code = code.replace(/`\/ uploads \/ \$\{req\.file\.filename\} `/g, "(uploadedUrls[0] || '/placeholder.png')");

// Disable DB copy logic
code = code.replace(/fs\.copyFileSync\(.*?\);/g, "throw new Error('FileSystem operations not supported on Workers');");
code = code.replace(/fs\.unlinkSync\(.*?\);/g, "");

// Remove app.listen since Pages Handles it
code = code.replace(/const server = app\.listen\([\s\S]*?\}\);/g, "");

code += `

// Helper to extract body in Hono safely without throwing for empty bodies
async function getBodySafely(c) {
    try {
        const contentType = c.req.header('content-type') || '';
        if (contentType.includes('multipart/form-data')) {
            const formData = await c.req.formData();
            const body = {};
            const files = [];
            for (const [key, value] of formData.entries()) {
                if (value instanceof File) {
                   files.push(value);
                } else {
                   body[key] = value;
                }
            }
            c.req.rawFiles = files; // save files to context for R2 upload
            return body;
        } else if (contentType.includes('json')) {
            return await c.req.json();
        } else if (contentType.includes('x-www-form-urlencoded')) {
            const body = await c.req.parseBody();
            return body;
        }
    } catch(e) {}
    return {};
}

// Pages Functions Entry Point
export const onRequest = async (context) => {
  const { request, env } = context;
  if (!db) {
    db = initDb(env.DATABASE_URL);
  }
  return handle(_honoApp)(context);
};
`;

fs.writeFileSync('functions/api/[[path]].js', code);
console.log('Created functions/api/[[path]].js');
