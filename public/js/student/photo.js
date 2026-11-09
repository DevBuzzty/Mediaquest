/*
 * photo.js: verkleinert Fotos im Browser und kodiert sie neu.
 * Das Zeichnen auf ein Canvas entfernt EXIF-Daten wie Ort und Kamera.
 */

const MAX_EDGE = 1600;
const MAX_BYTES = 4.5 * 1024 * 1024;
const QUALITIES = [0.82, 0.7, 0.55, 0.4];

const UNREADABLE = 'Dieses Bild konnte nicht gelesen werden. Bitte nimm ein anderes Foto.';

export class PhotoError extends Error {}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new PhotoError(UNREADABLE));
        image.src = url;
    });
}

function encode(canvas, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** Zielmaße: längste Kante höchstens maxEdge, nie vergrößern. */
export function scaledSize(width, height, maxEdge = MAX_EDGE) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function compressPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
        const image = await loadImage(url);
        if (!image.naturalWidth || !image.naturalHeight) throw new PhotoError(UNREADABLE);
        const { width, height } = scaledSize(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new PhotoError(UNREADABLE);
        context.drawImage(image, 0, 0, width, height);

        for (const quality of QUALITIES) {
            const blob = await encode(canvas, quality);
            if (!blob) throw new PhotoError(UNREADABLE);
            if (blob.size <= MAX_BYTES) return blob;
        }
        throw new PhotoError('Das Foto ist zu groß. Bitte nimm ein anderes Foto.');
    } finally {
        URL.revokeObjectURL(url);
    }
}
