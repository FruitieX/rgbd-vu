'use strict';

var Spawn = require('node-spawn');
var socket = require('socket.io-client')('http://localhost:9009');
var _ = require('underscore');
const color = require('tinycolor2');
var windowing = require('fft-windowing');

// number of LEDs in your setup
var numLeds = 90;

// number of LEDs in secondary strip
var numLedsSecondary = 11;
var secondaryMin = 20;
var secondaryMax = 60;

var audioBuffer = new Buffer(0);

// how many samples to consider for one fft computation
// lower = faster response times BUT you start to lose bass frequencies!
// must be power of 2
var windowSize = 2048;

// skip this many low frequency bins (stuff we can't hear isn't very interesting)
var skipBinsHead = 2;

// skip this many high frequency bins, nothing really interesting in them either
var skipBinsTail = 200;

// old pixel color retained by this percentage each frame, higher is smoother, lower is faster
var avgFactor = 0.925;

// all colors are scaled by this factor, reduce if too bright and vice versa
var scale = 0.075;

 // to avoid a lot of white pixels (lighness 1 = white, 0.5 = fully saturated, 0 = black)
var lightnessLimit = 0.5

// sample rate for incoming audio, affects pacat arguments and rate at which data is read
var sampleRate = 44100;

// frame rate to attempt to run FFT at, LEDs always updated at this rate
var framerate = 120;

// [computed] scale everything according to avg bin amplitude
var avgPeak = 0;

// fade avg peak out over time - in case user lowers volume
var avgPeakFade = 0.001;

var hueSpeed = 25;

// ... but never under the noise floor (in case playback stops)
// experiment with this value and set it to match the maximum peak
// of the lowest volume you'd realistically listen to music at
var avgPeakMin = 0.00001 // i found this value to work great in my setup

var avg = Array.apply(null, new Array(windowSize)).map(Number.prototype.valueOf, 0);

var palette = 1;

var calcColor = function(i, numLeds, total) {
    let c = null;
    const time = new Date().getTime();

    if (palette === 0) {
        let hue = hueSpeed * time / 1000 + i / numLeds * 360;

        hue %= 360;

        c = color({
            h: hue,
            s: 1,
            v: total || 0
        }).toRgb();
    } else if (palette === 1) {
        let fade = 50 * Math.sin(i / numLeds * 4 * Math.PI + (hueSpeed / 90) * time / 1000) + 50;
        c = color.mix(color('white'), color('red'), fade);
        c = color.mix(color('black'), c, total * 100).toRgb();
    }

    return c;
};

var findGlobalPeak = function(output) {
    // begin by fading out global peak
    avgPeak = avgPeak * (1 - avgPeakFade);

    var total = 0;
    output.forEach(function(band, i) {
        total += band;
    });

    avgPeak = Math.max(avgPeak, total / output.length);
    avgPeak = Math.max(avgPeak, avgPeakMin);
};

var avgResult = function(output) {
    var retval = [];
    _.each(output, function(band, index) {
        if (band) {
            avg[index] = avg[index] * avgFactor + band * (1 - avgFactor);
            avg[index] = Math.max(avg[index], band);
            retval[index] = avg[index];
        }
    });

    return retval;
};

var printSpectrum = function(spectrum) {
    spectrum = avgResult(spectrum);
    findGlobalPeak(spectrum);

    var leds = [];
    for (var i = 0; i < numLeds; i++) {
        var total = 0;

        // log scale on spectrum: low frequencies get very few bins,
        // high frequencies get lots of bins
        var sl = spectrum.length;
        var lo = Math.pow(sl, i / numLeds) - 1;
        var hi = Math.pow(sl, (i + 1) / numLeds) - 1;

        if (Math.floor(lo) === Math.floor(hi)) {
            hi++;
        }

        for (var j = Math.floor(lo); j < Math.floor(hi); j++) {
            // smooth out low frequencies by blending to nearest bins
            if (Math.floor(lo) + 1 === Math.floor(hi)) {
                let pctLo = 1 - (lo - Math.floor(lo));
                let pctHi = 1 - pctLo;
                total += spectrum[j] * pctLo;
                total += spectrum[j + 1] * pctHi;

                total /= avgPeak;
            } else {
                total += spectrum[j] / avgPeak;
            }
        }

        total *= scale;

        // lower loud sub-bass frequencies
        total *= Math.min(1, 0.5 + 20 * (lo / spectrum.length));

        total = Math.pow(total, 4);
        total = Math.min(total, lightnessLimit);

        let c = calcColor(i, numLeds, total);

        leds[i] = {
            r: c.r,
            g: c.g,
            b: c.b
        };
    }

    socket.emit('frame', {
        id: 0,
        name: 'Music',
        colors: leds
    });

    /*
    var secondaryLeds = [];

    var sRange = secondaryMax - secondaryMin;
    for (var i = 0; i < numLedsSecondary; i++) {
        var lo = Math.round(secondaryMin + i / numLedsSecondary * sRange);
        var hi = Math.round(secondaryMin + (i + 1) / numLedsSecondary * sRange);

        secondaryLeds[i] = {
            red: 0,
            green: 0,
            blue: 0
        }

        var led = secondaryLeds[i];
        for (var j = lo; j < hi; j++) {
            led.red += leds[j].red;
            led.green += leds[j].green;
            led.blue += leds[j].blue;
        }

        led.red /= hi - lo;
        led.green /= hi - lo;
        led.blue /= hi - lo;
    }
    socket.emit('frame', {
        id: 1,
        colors: secondaryLeds
    });
    */
};

var leds = [];

for (var i = 0; i < numLeds; i++) {
    leds[i] = color('black');
}

var dsp = require('digitalsignals');
var fft = new dsp.FFT(windowSize);
var magnitudes;
var runFFT = function(buffer) {
    var samples = [];
    for (var i = 0; i < buffer.length; i+= 2) {
        var sample = buffer.readInt16LE(i, true) / 32767.0;
        samples.push(sample);
    }

    var windowed = windowing.hann(samples);

    fft.forward(windowed);
    magnitudes = fft.spectrum.slice(skipBinsHead, fft.spectrum.length - skipBinsTail);

    printSpectrum(magnitudes);
};

setInterval(function() {
    if (audioBuffer.length < windowSize * 2) {
        // too little data, try again next time
        if (magnitudes) {
            printSpectrum(magnitudes);
        }
        return;
    }

    runFFT(audioBuffer.slice(0, windowSize * 2));
    audioBuffer = audioBuffer.slice(sampleRate / framerate * 2);
}, 1000 / framerate);

var handleData = function(data) {
    audioBuffer = Buffer.concat([audioBuffer, data]);

    if (audioBuffer.length >= windowSize * 2) {
        audioBuffer = audioBuffer.slice(audioBuffer.length - windowSize * 2);
    }
};

var spawn = Spawn({
    cmd: 'pacat',
    args: ['--record', '--raw', '--channels=1', '--format=s16le', '--rate=' + sampleRate, '--latency-msec=1'],
    onStdout: handleData
});

spawn.start();
