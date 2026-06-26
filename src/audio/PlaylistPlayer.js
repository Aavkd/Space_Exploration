export class PlaylistPlayer {
    constructor(audioEngine) {
        this.audio = audioEngine;
        this.currentStation = null;
        this.sourceNode = null;
        this.gainNode = null;
        this.isPlaying = false;
        this.volume = 1.0;
        this.baseGain = 1.0; // Boosted default base gain for custom stations
    }

    async playStation(station, volume) {
        this.volume = volume;
        const stationBaseGain = station.baseGain ?? this.baseGain;
        const targetGain = this.volume * stationBaseGain;

        // Initialize state on station if not present
        if (station.currentTrackIndex === undefined) {
            station.currentTrackIndex = station.tracks && station.tracks.length > 0
                ? Math.floor(Math.random() * station.tracks.length)
                : 0;
            station.playhead = Math.random() * 60; // random start between 0-60s
            station.trackStartTime = this.audio.context.currentTime - station.playhead;
            station.trackDurations = {};
        }

        if (this.currentStation === station) {
            if (this.gainNode) {
                const now = this.audio.context.currentTime;
                this.gainNode.gain.cancelScheduledValues(now);
                this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
                this.gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.15);
            }
            return;
        }

        // Stop current playlist playback
        this.stop();

        this.currentStation = station;
        this.isPlaying = true;

        // Calculate virtual playhead position since the broadcast timeline started
        const now = this.audio.context.currentTime;
        let elapsed = now - station.trackStartTime;
        let trackIndex = station.currentTrackIndex;
        const tracks = station.tracks;

        if (tracks && tracks.length > 0) {
            let duration = station.trackDurations[trackIndex] || this._estimateTrackDuration(tracks[trackIndex]);

            // Advance tracks virtually based on elapsed time
            let loopCount = 0;
            while (elapsed >= duration && loopCount < 200) { // loopCount prevents infinite loops
                elapsed -= duration;
                trackIndex = (trackIndex + 1) % tracks.length;
                duration = station.trackDurations[trackIndex] || this._estimateTrackDuration(tracks[trackIndex]);
                loopCount++;
            }

            station.currentTrackIndex = trackIndex;
            station.playhead = elapsed;
            station.trackStartTime = now - elapsed;

            await this._playCurrentTrack();
        }
    }

    async _playCurrentTrack() {
        if (!this.isPlaying || !this.currentStation) return;

        const station = this.currentStation;
        const tracks = station.tracks;
        if (!tracks || tracks.length === 0) return;

        const trackIndex = station.currentTrackIndex;
        const track = tracks[trackIndex];
        const trackName = track.file;
        const folder = station.folder;
        const path = `./assets/audio/custom_radios/${folder}/${trackName}`;

        console.info(`Radio Transceiver: Loading custom track [${trackIndex + 1}/${tracks.length}] "${trackName}" at offset ${station.playhead.toFixed(1)}s`);

        const buffer = await this.audio.loadBuffer(path);
        if (!buffer) {
            if (this.isPlaying && this.currentStation === station) {
                console.warn(`Radio Transceiver: Failed to load track "${trackName}", skipping to next track.`);
                this.playNextTrack();
            }
            return;
        }

        if (!this.isPlaying || this.currentStation !== station) {
            return;
        }

        // Cache duration
        station.trackDurations = station.trackDurations || {};
        station.trackDurations[trackIndex] = buffer.duration;

        // If the playhead exceeds the loaded duration, recalculate
        if (station.playhead >= buffer.duration) {
            const now = this.audio.context.currentTime;
            station.playhead = station.playhead % buffer.duration;
            station.trackStartTime = now - station.playhead;
        }

        const context = this.audio.context;
        const sourceNode = context.createBufferSource();
        sourceNode.buffer = buffer;

        const gainNode = context.createGain();
        const stationBaseGain = station.baseGain ?? this.baseGain;
        const targetGain = this.volume * stationBaseGain;

        gainNode.gain.value = 0;
        sourceNode.connect(gainNode);

        // Connect to the signals bus for better default volume
        const signalsBus = this.audio.getBusInput('signals');
        if (signalsBus) {
            gainNode.connect(signalsBus);
        } else {
            gainNode.connect(this.audio.listener.getInput());
        }

        this.sourceNode = sourceNode;
        this.gainNode = gainNode;

        const nowTime = context.currentTime;
        gainNode.gain.setValueAtTime(0, nowTime);
        gainNode.gain.linearRampToValueAtTime(targetGain, nowTime + 0.5); // 0.5s fade-in

        sourceNode.onended = () => {
            if (this.sourceNode === sourceNode) {
                this.sourceNode = null;
                this.gainNode = null;
                if (this.isPlaying) {
                    this.playNextTrack();
                }
            } else {
                // If this node is no longer active, clean up connections
                try {
                    sourceNode.disconnect();
                    gainNode.disconnect();
                } catch (e) {}
            }
        };

        const startOffset = Math.max(0, Math.min(station.playhead, buffer.duration - 0.05));
        sourceNode.start(0, startOffset);
    }

    _estimateTrackDuration(track) {
        if (!track || !track.size) return 180; // fallback to 3 minutes
        const ext = track.file.split('.').pop().toLowerCase();
        if (ext === 'wav') {
            return track.size / 176400; // CD quality stereo WAV estimation
        }
        return track.size / 24000; // 192kbps MP3 estimation
    }

    playNextTrack() {
        if (!this.isPlaying || !this.currentStation) return;
        const station = this.currentStation;
        const tracks = station.tracks;
        if (!tracks || tracks.length === 0) return;

        station.currentTrackIndex = (station.currentTrackIndex + 1) % tracks.length;
        station.playhead = 0;
        station.trackStartTime = this.audio.context.currentTime;

        this._playCurrentTrack();
    }

    stop() {
        this.isPlaying = false;
        const sourceNode = this.sourceNode;
        const gainNode = this.gainNode;

        this.sourceNode = null;
        this.gainNode = null;
        this.currentStation = null;

        if (gainNode && sourceNode) {
            const now = this.audio.context.currentTime;
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(gainNode.gain.value, now);
            gainNode.gain.linearRampToValueAtTime(0, now + 0.5); // 0.5s fade-out

            setTimeout(() => {
                try {
                    sourceNode.stop();
                    sourceNode.disconnect();
                    gainNode.disconnect();
                } catch (e) {}
            }, 600);
        }
    }
}
