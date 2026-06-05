/**
 * Helper to upload a file to Cloudflare R2
 * @param {File} file 
 * @param {object} env - The Cloudflare Env object containing the BUCKET binding
 * @returns {Promise<string>} - The filename in R2
 */
export async function uploadToR2(file, env) {
    if (!file || !env.BUCKET) return null;
    
    const extension = file.name.split('.').pop();
    const filename = `${Date.now()}-${Math.random().toString(36).substring(2)}.${extension}`;
    
    // Save to R2
    await env.BUCKET.put(filename, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type }
    });
    
    return filename;
}
