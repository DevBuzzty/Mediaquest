'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const IMAGE_TYPES = {
    jpeg: { ext: 'jpg', mime: 'image/jpeg' },
    png: { ext: 'png', mime: 'image/png' },
    webp: { ext: 'webp', mime: 'image/webp' }
};
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Erkennt den Bildtyp an den ersten Bytes, nie an Name oder Client-Angabe. */
function detectImageType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return IMAGE_TYPES.jpeg;
    if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return IMAGE_TYPES.png;
    if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return IMAGE_TYPES.webp;
    return null;
}

const AUDIO_TYPES = {
    mp3: { ext: 'mp3', mime: 'audio/mpeg' },
    m4a: { ext: 'm4a', mime: 'audio/mp4' },
    ogg: { ext: 'ogg', mime: 'audio/ogg' },
    wav: { ext: 'wav', mime: 'audio/wav' }
};
const M4A_BRANDS = new Set(['M4A ', 'M4B ', 'mp41', 'mp42', 'isom', 'iso2', 'dash']);

function isMpegFrame(buffer) {
    if (buffer[0] !== 0xff || (buffer[1] & 0xe0) !== 0xe0) return false;
    const version = (buffer[1] >> 3) & 0x03;
    const layer = (buffer[1] >> 1) & 0x03;
    const bitrate = buffer[2] >> 4;
    const sampleRate = (buffer[2] >> 2) & 0x03;
    return version !== 1 && layer !== 0 && bitrate !== 15 && sampleRate !== 3;
}

/** Erkennt den Audio-Typ an den ersten Bytes, nie an Name oder Client-Angabe. */
function detectAudioType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    const ascii = (from, to) => buffer.toString('latin1', from, to);
    if (ascii(0, 4) === 'OggS') return AUDIO_TYPES.ogg;
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return AUDIO_TYPES.wav;
    if (ascii(4, 8) === 'ftyp' && M4A_BRANDS.has(ascii(8, 12))) return AUDIO_TYPES.m4a;
    if (ascii(0, 3) === 'ID3' || isMpegFrame(buffer)) return AUDIO_TYPES.mp3;
    return null;
}

function randomFilename(ext) {
    return `${crypto.randomBytes(16).toString('hex')}.${ext}`;
}

function filePath(uploadsDir, filename) {
    return path.join(uploadsDir, path.basename(filename));
}

async function writeUpload(uploadsDir, filename, buffer) {
    await fs.promises.mkdir(uploadsDir, { recursive: true });
    await fs.promises.writeFile(filePath(uploadsDir, filename), buffer, { flag: 'wx' });
}

/** Loescht Dateien; fehlende Dateien sind kein Fehler. */
async function removeUploads(uploadsDir, filenames, logger) {
    await Promise.all(filenames.map(async (filename) => {
        try {
            await fs.promises.unlink(filePath(uploadsDir, filename));
        } catch (err) {
            if (err.code !== 'ENOENT') logger.error(`Upload ${filename} konnte nicht gelöscht werden`, err);
        }
    }));
}

function filenameFromUrl(url) {
    const match = /^\/uploads\/([a-f0-9]{32}\.(?:jpg|png|webp))$/.exec(url);
    return match ? match[1] : null;
}

module.exports = { detectImageType, detectAudioType, randomFilename, filePath, writeUpload, removeUploads, filenameFromUrl };
