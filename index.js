'use strict';

var Spawn = require('node-spawn');
var socket = require('socket.io-client')('http://localhost:9009');
var _ = require('underscore');
var one = require('onecolor');
var windowing = require('fft-windowing');

// number of LEDs in your setup
var numLeds = 91;

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
var scale = 0.08;

 // to avoid a lot of white pixels (lighness 1 = white, 0.5 = fully saturated, 0 = black)
var lightnessLimit = 0.6

// sample rate for incoming audio, affects pacat arguments and rate at which data is read
var sampleRate = 44100;

// frame rate to attempt to run FFT at, LEDs always updated at this rate
var framerate = 60;

// [computed] scale everything according to avg bin amplitude
var avgPeak = 0;

// fade avg peak out over time - in case user lowers volume
var avgPeakFade = 0.001;

// ... but never under the noise floor (in case playback stops)
// experiment with this value and set it to match the maximum peak
// of the lowest volume you'd realistically listen to music at
var avgPeakMin = 0.00001 // i found this value to work great in my setup

var hue = 0;
var avg = Array.apply(null, new Array(windowSize)).map(Number.prototype.valueOf, 0);

var findGlobalPeak = function(output) {
    // begin by fading out global peak
    avgPeak = avgPeak * (1 - avgPeakFade);

    // uncomment if tweaking avgPeakMin
    //console.log(avgPeak);

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

    hue += 0.001;

    var saturationBands = 0;

    var leds = [];
    for (var i = 0; i < numLeds; i++) {
        var total = 0;

        // log scale on spectrum: low frequencies get very few bins,
        // high frequencies get lots of bins
        var sl = spectrum.length;
        var lo = Math.round(Math.pow(sl, i / numLeds)) - 1;
        var hi = Math.round(Math.pow(sl, (i + 1) / numLeds)) - 1;

        if (lo === hi) {
            hi++;
        }

        for (var j = lo; j < hi; j++) {
            total += spectrum[j] / avgPeak;
        }

        //total /= hi - lo;
        total *= scale;

        // lower sub-bass frequencies, they're LOUD
        total *= Math.min(1, 0.2 + 100 * (lo / spectrum.length));

        //total = (Math.exp(total) - 1) / (Math.E - 1);
        total = Math.pow(total, 4);

        if (total >= lightnessLimit) {
            saturationBands++;
        }
        total = Math.min(total, lightnessLimit);

        var color = new one.HSL(hue + i / 100, 1, total || 0);
        leds[numLeds - 1 - i] = {
            red: color.red() * 255,
            green: color.green() * 255,
            blue: color.blue() * 255
        };
    }

    console.log('bands saturated: ' + saturationBands);
    socket.emit('frame', leds);
};

var leds = [];

for (var i = 0; i < numLeds; i++) {
    leds[i] = one('#000');
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
        console.log('too little data');
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
    args: ['--record', '--raw', '--channels=1', '--format=s16le', '--rate=' + sampleRate],
    onStdout: handleData
});

spawn.start();
