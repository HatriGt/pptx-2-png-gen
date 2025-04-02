import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import AdmZip from 'adm-zip';
import path from 'path';
import { fileURLToPath } from 'url';
import { DOMParser, XMLSerializer } from 'xmldom';
import FormData from 'form-data';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const TEMPLATE_URL = "https://utlihxppncolcysnwrrj.supabase.co/storage/v1/object/public/biodata//RanjithBiodata.pptx";
const TEMP_FILE = "template.pptx";

// Check for required environment variables
if (!process.env.CONVERT_API_KEY) {
    console.error('CONVERT_API_KEY is not set in environment variables');
    process.exit(1);
}

// Serve static files from 'public' directory
app.use(express.static('public'));
app.use(express.json());

// Ensure public directory exists
if (!fs.existsSync('public')) {
    fs.mkdirSync('public');
}

function replacePlaceholders(content, replacements) {
    const doc = new DOMParser().parseFromString(content, 'text/xml');
    const textNodes = doc.getElementsByTagName('a:t');

    for (let i = 0; i < textNodes.length; i++) {
        let textNode = textNodes[i];
        let textValue = textNode.textContent;

        // Replace placeholders
        for (const [key, value] of Object.entries(replacements)) {
            if (textValue.includes(key)) {
                textValue = textValue.replace(new RegExp(key, "g"), value);
                // Update the text node
                textNode.textContent = textValue;
            }
        }
    }

    return new XMLSerializer().serializeToString(doc);
}

async function processAndConvertPPTX(pptxPath, replacements) {
    try {
        const zip = new AdmZip(pptxPath);
        const entries = zip.getEntries();
        
        // Process each slide
        entries.forEach(entry => {
            if (entry.entryName.startsWith("ppt/slides/slide") && entry.entryName.endsWith(".xml")) {
                console.log("Processing slide:", entry.entryName);
                let content = entry.getData().toString('utf8');
                content = replacePlaceholders(content, replacements);
                zip.updateFile(entry.entryName, Buffer.from(content, 'utf8'));
            }
        });

        // Get the modified PPTX as a buffer
        const pptxBuffer = zip.toBuffer();

        // Create form data for the API request
        const formData = new FormData();
        formData.append('File', pptxBuffer, {
            filename: 'biodata.pptx',
            contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        });

        // Send to ConvertAPI using environment variable
        const response = await fetch('https://v2.convertapi.com/convert/pptx/to/png', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.CONVERT_API_KEY}`
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`ConvertAPI error: ${response.statusText}`);
        }

        // Parse the JSON response
        const result = await response.json();
        
        if (!result.Files || result.Files.length === 0) {
            throw new Error('No files in conversion response');
        }

        // Get the base64 data of the first file
        const fileData = result.Files[0].FileData;
        if (!fileData) {
            throw new Error('No file data in conversion response');
        }

        // Convert base64 to buffer
        const pngBuffer = Buffer.from(fileData, 'base64');
        return pngBuffer;

    } catch (error) {
        console.error('Error in processAndConvertPPTX:', error);
        throw error;
    }
}

app.post('/generate-biodata', async (req, res) => {
    try {
        const { birthDate, rasi, natchathiram } = req.body;
        if (!birthDate || !rasi || !natchathiram) {
            return res.status(400).json({ error: "Missing required values" });
        }
        
        console.log("Downloading template from:", TEMPLATE_URL);
        // Download template PPTX
        const response = await fetch(TEMPLATE_URL);
        if (!response.ok) {
            throw new Error(`Failed to download template: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(buffer);
        fs.writeFileSync(TEMP_FILE, uint8Array);
        console.log("Template downloaded and saved to:", TEMP_FILE);

        const replacements = {
            'BirthDate': birthDate,
            'X-Rasi': rasi,
            'X-Natchathiram': natchathiram
        };

        // Process PPTX and convert to PNG
        const pngBuffer = await processAndConvertPPTX(TEMP_FILE, replacements);

        // Clean up temporary file
        fs.unlinkSync(TEMP_FILE);

        // Set response headers and send PNG directly
        res.set({
            'Content-Type': 'image/png',
            'Content-Disposition': 'attachment; filename="biodata.png"',
            'Content-Length': pngBuffer.length
        });
        res.send(pngBuffer);

    } catch (error) {
        console.error("Error generating Biodata:", error);
        res.status(500).json({ 
            error: "Internal server error",
            message: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});