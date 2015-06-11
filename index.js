var fs = require('fs');
var Spawn = require('node-spawn');
var _ = require('underscore');
var socket = require('socket.io-client')('http://fruitiex.org:9191');

var audioBuffer = new Buffer(0);
var windowSize = 4096;
var avgFactor = 0.5;
var avg = Array.apply(null, new Array(windowSize / 2)).map(Number.prototype.valueOf,0);
var fft = require('kissfft').fft;

var printSpectrum = function() {
    process.stdout.write('\u001B[2J\u001B[0;0f');
    for(var i = 0; i < windowSize / 64; i++) {
        if (avg[i]) {
            console.log(Array(Math.floor(avg[i])).join('='));
        } else {
            console.log();
        }
    }
};

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

    var complex = [];
    _.each(samples, function(val) {
        complex.push(val, 0);
    });
    var input = new Float32Array(complex);
    var output = new Float32Array(complex.length);
    fft(input, output, function(err, outputObj) {
        var output = [];
        for (var i = 0; i < (outputObj.length / 2) + 1; i++) {
            var real = outputObj[(i * 2)];
            var imag = outputObj[(i * 2) + 1];
            output[i] = Math.sqrt((real * real) + (imag * imag));
        }
        _.map(output, function(band) {
            return 20 * Math.log10(band);
        });
        _.each(output, function(band, index) {
            avg[index] = avgFactor * avg[index] + (1 - avgFactor) * band;
        });

        printSpectrum();

        socket.emit('color', 'hsl(154, 100%, ' + Math.round(avg[10]) + '%)');
    });
};

var spawn = Spawn({
    cmd: 'pacat',
    args: ['--record', '--raw', '--channels=1', '--format=s16le'],
    onStdout: runFFT
});

spawn.start();
