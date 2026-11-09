// Tailwind 3 CLI, Build: npm run build:css (schreibt public/css/app.css, die Datei liegt mit im Repository).
// Klassennamen müssen vollständig im Quelltext stehen. Zusammengesetzte Namen wie `bg-${farbe}-500` findet der Scan nicht.
/** @type {import('tailwindcss').Config} */
module.exports = {
    content: {
        relative: true,
        files: ['./public/**/*.html', './public/js/**/*.js']
    },
    theme: {
        extend: {
            keyframes: {
                'wr-modal-in': {
                    from: { opacity: '0', transform: 'scale(0.95)' },
                    to: { opacity: '1', transform: 'scale(1)' }
                }
            },
            animation: {
                'wr-modal-in': 'wr-modal-in 150ms ease-out'
            }
        }
    },
    plugins: []
};
