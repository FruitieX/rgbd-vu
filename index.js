'use strict';

var numLeds = 91;

var fs = require('fs');
var Spawn = require('node-spawn');
var socket = require('socket.io-client')('http://localhost:9009');
var _ = require('underscore');
var one = require('onecolor');

// maximum values observed in a while
var bands = [
    {
        // sub bass
        minBin: 2,
        maxBin: 8,
        value: 0,
        peak: 0,
        peakBin: 2
    }, {
        // kick drum
        minBin: 9,
        maxBin: 15,
        value: 0,
        peak: 0,
        peakBin: 9
    }, {
        // kick drum
        minBin: 16,
        maxBin: 29,
        value: 0,
        peak: 0,
        peakBin: 16
    }, {
        // snare
        minBin: 30,
        maxBin: 59,
        value: 0,
        peak: 0,
        peakBin: 30
    }, {
        // snare
        minBin: 60,
        maxBin: 99,
        value: 0,
        peak: 0,
        peakBin: 60
    }, {
        // snare
        minBin: 100,
        maxBin: 149,
        value: 0,
        peak: 0,
        peakBin: 100
    }, {
        // hihat
        minBin: 150,
        maxBin: 299,
        value: 0,
        peak: 0,
        peakBin: 150
    }, {
        // hihat
        minBin: 300,
        maxBin: 374,
        value: 0,
        peak: 0,
        peakBin: 300
    }, {
        // hihat
        minBin: 375,
        maxBin: 449,
        value: 0,
        peak: 0,
        peakBin: 375
    }, {
        // hihat
        minBin: 450,
        maxBin: 599,
        value: 0,
        peak: 0,
        peakBin: 450
    }, {
        minBin: 600,
        maxBin: 1023,
        value: 0,
        peak: 0,
        peakBin: 700
    }
];
var dPeak = 0.9975;

var audioBuffer = new Buffer(0);
var windowSize = 4096;
//var binsPerLed = Math.floor((windowSize / 8) / numLeds);
var binsPerLed = Math.floor((windowSize / 5) / numLeds);
var avgFactor = 0.9;
var avgFactor = 0.95;
var hueAvgFactor = 0.99;
var fftInPlace = require('fft-js').fftInPlace;
var fftUtil = require('fft-js').util;

var hue = 0;
var avgHue = 0;
var avg = Array.apply(null, new Array(windowSize / 2)).map(Number.prototype.valueOf, 0);
var globalPeak = 0;

var findPeakBins = function(output) {
    globalPeak = globalPeak * dPeak;
    _.each(bands, function(band) {
        var peak = 0;
        for (var i = band.minBin; i < band.maxBin; i++) {
            if (output[i] - avg[i] > peak) {
                peak = output[i] - avg[i];
                //var binChangeAvg = 0.95;
                //band.peakBin = band.peakBin * binChangeAvg + (1 - binChangeAvg) * i;
                band.peakBin = i;
            }
            if (output[i] > globalPeak) {
                globalPeak = output[i];
            }
        }
    });
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

    var leds = [];
    for (var i = 0; i < numLeds; i++) {
        var total = 0;

        for (var j = 0; j < binsPerLed; j++) {
            total += output[i * binsPerLed + j];
        }
        total /= binsPerLed;

        // lower bass frequencies, boost high frequencies
        total *= (0.65 + 1.5 * i / numLeds);

        //total = (Math.exp(total) - 1) / (Math.E - 1);
        total *= total;
        total = Math.min(total, 0.8);

        var color = new one.HSL(hue + i / 100, 1, total || 0);
        leds[numLeds - 1 - i] = {
            red: color.red() * 255,
            green: color.green() * 255,
            blue: color.blue() * 255
        };
    }

    socket.emit('frame', leds);
};

var leds = [];

for (var i = 0; i < numLeds; i++) {
    leds[i] = one('#000');
}

var runFFT = function(newData) {
    audioBuffer = Buffer.concat([audioBuffer, newData]);

    if (audioBuffer.length < windowSize) {
        // too little data, try again next time
        console.log('too little data');
        return;
    }

    audioBuffer = audioBuffer.slice(audioBuffer.length - windowSize);

    var samples = [];
    for (var i = 0; i < windowSize; i+= 2) {
        var sample = audioBuffer.readInt16LE(i, true) / 32767.0;
        samples.push(sample);
    }

    fftInPlace(samples);

    var magnitudes = fftUtil.fftMag(samples);

    var avg = avgResult(magnitudes);
    //findPeakBins(avg);
    printSpectrum(avg);
};

var spawn = Spawn({
    cmd: 'pacat',
    args: ['--record', '--raw', '--channels=1', '--format=s16le'],
    onStdout: runFFT
});

spawn.start();
