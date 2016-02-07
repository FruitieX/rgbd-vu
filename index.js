'use strict';

var numLeds = 91;

var Spawn = require('node-spawn');
var socket = require('socket.io-client')('http://localhost:9009');
var _ = require('underscore');
var one = require('onecolor');
var windowing = require('fft-windowing');

var audioBuffer = new Buffer(0);
//var windowSize = 4096;
var windowSize = 1024;
//var windowSize = 8192;

// computed later
var binsPerLed;

// skip this many low frequency bins
var skipBinsHead = 0;

// skip this many high frequency bins, nothing interesting in them
var skipBinsTail = 300;

// pixel colors toward new value by this much each frame
var avgFactor = 0.95;

var hue = 0;
var avg = Array.apply(null, new Array(windowSize)).map(Number.prototype.valueOf, 0);

// scale everything according to avg bin amplitude
var avgPeak = 0;

// fade avg peak out over time - in case user lowers volume
var avgPeakFade = 0.001;

// ... but never under the noise floor (in case playback stops)
// experiment with this value and set it to match the maximum peak
// of the lowest volume you'd realistically listen to music at
var avgPeakMin = 0.0001 // i found this value to work great in my setup

var lightnessLimit = 0.6 // to avoid a lot of white pixels

var findGlobalPeak = function(output) {
    // begin by fading out global peak
    avgPeak = avgPeak * (1 - avgPeakFade);

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

var printSpectrum = function(output) {
    hue += 0.001;

    var saturationBands = 0;

    var leds = [];
    for (var i = 0; i < numLeds; i++) {
        var total = 0;

        for (var j = 0; j < binsPerLed; j++) {
            total += output[i * binsPerLed + j] / avgPeak;
        }
        total /= binsPerLed;

        // lower bass frequencies, boost high frequencies
        total *= (0.5 + 2 * i / numLeds);

        // no really, lower bass frequencies even more, they're LOUD
        total *= Math.min(1, 0.1 + 10 * (i / numLeds));

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

    //console.log('bands saturated: ' + saturationBands);
    socket.emit('frame', leds);
};

var leds = [];

for (var i = 0; i < numLeds; i++) {
    leds[i] = one('#000');
}

var dsp = require('digitalsignals');
var fft = new dsp.FFT(windowSize, 44100);
var runFFT = function(newData) {
    // TODO: match me with window size
    console.log(newData.length);
    audioBuffer = Buffer.concat([audioBuffer, newData]);

    if (audioBuffer.length < windowSize * 2) {
        // too little data, try again next time
        console.log('too little data');
        return;
    }

    audioBuffer = audioBuffer.slice(audioBuffer.length - windowSize * 2);

    var samples = [];
    for (var i = 0; i < audioBuffer.length; i+= 2) {
        var sample = audioBuffer.readInt16LE(i, true) / 32767.0;
        samples.push(sample);
    }

    // TODO: needed? does dsp.js do this?
    //var windowed = windowing.hann(samples);
    var windowed = samples;

    fft.forward(windowed);
    var magnitudes = fft.spectrum;

    magnitudes = magnitudes.slice(skipBinsHead, magnitudes.length - skipBinsTail);

    binsPerLed = Math.floor(magnitudes.length / numLeds);

    var avg = avgResult(magnitudes);
    findGlobalPeak(avg);
    printSpectrum(avg);
};

var spawn = Spawn({
    cmd: 'pacat',
    args: ['--record', '--raw', '--channels=1', '--format=s16le'],
    onStdout: runFFT
});

spawn.start();
