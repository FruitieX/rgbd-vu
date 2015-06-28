var fs = require('fs');
var Spawn = require('node-spawn');
var _ = require('underscore');
var socket = require('socket.io-client')('http://fruitiex.org:9191');
var one = require('onecolor');

// maximum values observed in a while
var bands = {
    bass: {
        bin: 4,
        value: 0,
        peak: 0
    },
    snare: {
        bin: 15,
        value: 0,
        peak: 0
    },
    hihat: {
        bin: 900,
        value: 0,
        peak: 0
    }
}
var ival = 0;
//var minVal = 100;
var dPeak = 0.995;

var audioBuffer = new Buffer(0);
var windowSize = 4096;
var avgFactor = 0.80;
var fft = require('kissfft').fft;

var hue = 0;
var samplingRate = 44100;
var minF = 0;
var maxF = 22050;
var emitBand = 0;
var avg = Array.apply(null, new Array(windowSize / 2)).map(Number.prototype.valueOf, 0);

var printSpectrum = function(output) {
    hue += 0.0005;

    // adjust intensity by approx. kick drum frequencies
    //var intensity = getAmplitude(100, 6);
    var intensity = output[bands.bass.bin];
    bands.bass.peak = Math.max(1, Math.max(bands.bass.peak * dPeak, intensity));
    bands.bass.value = bands.bass.value * avgFactor + (1 - avgFactor) * (Math.exp(Math.pow(intensity / bands.bass.peak, 4)) - 1) / (Math.E - 1);
    bands.bass.value = Math.max(bands.bass.value, (Math.exp(Math.pow(intensity / bands.bass.peak, 4)) - 1) / (Math.E - 1));
    //bands.bass.value = (Math.exp(Math.pow(intensity / bands.bass.peak, 2)) - 1) / (Math.E - 1);
    //minVal = Math.min(minVal * (2 - dVal), intensity);
    //console.log(minVal);
    //
    intensity = output[bands.snare.bin];
    bands.snare.peak = Math.max(1, Math.max(bands.snare.peak * dPeak, intensity));
    bands.snare.value = bands.snare.value * avgFactor + (1 - avgFactor) * (Math.exp(Math.pow(intensity / bands.snare.peak, 4)) - 1) / (Math.E - 1);
    bands.snare.value = Math.max(bands.snare.value, (Math.exp(Math.pow(intensity / bands.snare.peak, 4)) - 1) / (Math.E - 1));

    intensity = output[bands.hihat.bin];
    bands.hihat.peak = Math.max(0.01, Math.max(bands.hihat.peak * dPeak, intensity));
    bands.hihat.value = bands.hihat.value * avgFactor + (1 - avgFactor) * (Math.exp(Math.pow(intensity / bands.hihat.peak, 4)) - 1) / (Math.E - 1);
    //bands.hihat.value = Math.max(bands.hihat.value, (Math.exp(Math.pow(intensity / bands.hihat.peak, 4)) - 1) / (Math.E - 1));

    //bands.bass.value = Math.max(bands.bass.value * avgFactor, bands.bass.value * 100 - 25);
    var bass = bands.bass.value
    console.log(Math.floor(bands.bass.value * 100) + '\t' + Math.floor(bands.snare.value * 100) + '\t' + Math.floor(bands.hihat.value * 100));
    //socket.emit('color', 'hsl(' + Math.round(hue) + ', 100%, ' + Math.round(((intensity - minVal) / (imaxVal - minVal)) * 50) + '%)');
    //var colorBass = onecolor.color('hsl(' + Math.round(hue)
    var vuColor = one('#000')
        .red(bands.bass.value)
        .blue(bands.snare.value)
        //.green(bands.hihat.value)
        .hue(hue, true);
    socket.emit('color', vuColor.css());
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
        for (var i = 0; i < (windowSize / 2); i++) {
            var real = outputObj[(i * 2)];
            var imag = outputObj[(i * 2) + 1];
            output[i] = Math.sqrt((real * real) + (imag * imag));
        }
        /*
        output = _.map(output, function(band) {
            return 20 * Math.log10(band);
        });
        */

        //avgResult(output);
        printSpectrum(output);
    });
};

var spawn = Spawn({
    cmd: 'pacat',
    args: ['--record', '--raw', '--channels=1', '--format=s16le'],
    onStdout: runFFT
});

spawn.start();
