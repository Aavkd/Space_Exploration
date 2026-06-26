const fs = require('fs');
const path = require('path');

// Resolve the custom_radios folder relative to the script directory
const rootDir = path.resolve(__dirname, 'assets/audio/custom_radios');

console.log(`Scanning custom radios directory: ${rootDir}`);

if (!fs.existsSync(rootDir)) {
    console.error(`Error: Directory ${rootDir} does not exist.`);
    process.exit(1);
}

try {
    const files = fs.readdirSync(rootDir);
    const stations = [];

    for (const file of files) {
        const fullPath = path.join(rootDir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            const tracks = fs.readdirSync(fullPath)
                .filter(f => {
                    const ext = path.extname(f).toLowerCase();
                    return ext === '.mp3' || ext === '.wav';
                })
                .map(f => {
                    const trackPath = path.join(fullPath, f);
                    const trackStat = fs.statSync(trackPath);
                    return {
                        file: f,
                        size: trackStat.size
                    };
                });

            // Only add the station if it has playable tracks
            if (tracks.length > 0) {
                stations.push({
                    name: file.replace(/_/g, ' '),
                    folder: file,
                    tracks: tracks
                });
                console.log(`Found station: "${file}" with ${tracks.length} track(s)`);
            } else {
                console.log(`Skipping empty station directory: "${file}"`);
            }
        }
    }

    const manifestPath = path.join(rootDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(stations, null, 2), 'utf8');
    console.log(`Successfully generated manifest: ${manifestPath}`);
} catch (err) {
    console.error('An error occurred during manifest generation:', err);
    process.exit(1);
}
