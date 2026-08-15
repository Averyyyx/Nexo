const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');
const outputDir = path.join(__dirname, '..', 'electron', 'icons');

// Создаем директорию для иконок
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Размеры для иконок
const sizes = [16, 32, 48, 64, 128, 256, 512];

// Функция для конвертации SVG в PNG
async function convertSvgToPng(svgPath, outputPath, size) {
    try {
        await sharp(svgPath)
            .resize(size, size)
            .png()
            .toFile(outputPath);
        console.log(`Converted ${svgPath} to ${outputPath} (${size}x${size})`);
    } catch (error) {
        console.error(`Error converting ${svgPath}:`, error);
    }
}

// Функция для создания ICO файла
async function createIco(pngPaths, outputPath) {
    try {
        // Для простоты используем самый большой размер
        const largestPng = pngPaths[pngPaths.length - 1];
        await sharp(largestPng)
            .toFile(outputPath.replace('.png', '.ico'));
        console.log(`Created ICO: ${outputPath.replace('.png', '.ico')}`);
    } catch (error) {
        console.error('Error creating ICO:', error);
    }
}

// Конвертируем основные иконки
async function convertIcons() {
    console.log('Starting icon conversion...');

    // Desktop иконки
    const desktopIcons = [
        'Nexo-Desctop-ico.svg',
        'Nexo-desctop-ico-1ping.svg',
        'Nexo-desctop-ico-2ping.svg',
        'Nexo-desctop-ico-3ping.svg',
        'Nexo-desctop-ico-4ping.svg',
        'Nexo-desctop-ico-5ping.svg',
        'Nexo-desctop-ico-6ping.svg',
        'Nexo-desctop-ico-7ping.svg',
        'Nexo-desctop-ico-8ping.svg',
        'Nexo-desctop-ico-9ping.svg'
    ];

    for (const icon of desktopIcons) {
        const svgPath = path.join(assetsDir, icon);
        const baseName = icon.replace('.svg', '');
        
        if (fs.existsSync(svgPath)) {
            // Создаем PNG разных размеров
            const pngPaths = [];
            for (const size of sizes) {
                const pngPath = path.join(outputDir, `${baseName}-${size}.png`);
                await convertSvgToPng(svgPath, pngPath, size);
                pngPaths.push(pngPath);
            }
            
            // Создаем ICO для Windows
            await createIco(pngPaths, path.join(outputDir, `${baseName}.png`));
        }
    }

    // System tray иконки
    const trayIcons = [
        'nexo-ico-mini.svg',
        'nexo-ico-mini-ping.svg'
    ];

    for (const icon of trayIcons) {
        const svgPath = path.join(assetsDir, icon);
        const baseName = icon.replace('.svg', '');
        
        if (fs.existsSync(svgPath)) {
            // Для tray нужны только маленькие размеры
            const traySizes = [16, 32, 48];
            for (const size of traySizes) {
                const pngPath = path.join(outputDir, `${baseName}-${size}.png`);
                await convertSvgToPng(svgPath, pngPath, size);
            }
        }
    }

    console.log('Icon conversion completed!');
}

convertIcons().catch(console.error);