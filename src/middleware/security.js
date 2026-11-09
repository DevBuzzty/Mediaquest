'use strict';

const helmet = require('helmet');

function createHelmet(config) {
    return helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                scriptSrcAttr: ["'none'"],
                styleSrc: ["'self'"],
                imgSrc: ["'self'", 'data:', 'blob:'],
                connectSrc: ["'self'"],
                fontSrc: ["'self'"],
                mediaSrc: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                frameAncestors: ["'none'"],
                // Nur hinter HTTPS: lokal wuerden sonst alle Requests umgebogen.
                ...(config.isProduction ? { upgradeInsecureRequests: [] } : {})
            }
        },
        strictTransportSecurity: config.isProduction,
        referrerPolicy: { policy: 'same-origin' }
    });
}

module.exports = { createHelmet };
