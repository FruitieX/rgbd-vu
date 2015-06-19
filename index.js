var fs = require('fs');
var Spawn = require('node-spawn');
var _ = require('underscore');
var socket = require('socket.io-client')('http://fruitiex.org:9191');

// maximum value observed in a while
var ival = 0;
var imaxVal = 0;
//var minVal = 100;
var dVal = 0.995;

var audioBuffer = new Buffer(0);
var windowSize = 4096;
var avgFactor = 0.8;
var fft = require('kissfft').fft;

var hue = 0;
var samplingRate = 44100;
var numBands = 256;
var minF = 0;
var maxF = 22050;
var emitBand = 0;
var avg = Array.apply(null, new Array(windowSize / 2)).map(Number.prototype.valueOf, 0);

var getAmplitude = function(f, spreadF) {
    var midIndex = Math.round(f * windowSize / samplingRate);
    var spread = Math.round(spreadF * windowSize / samplingRate);

    var sum = 0;
    for (var i = Math.max(0, midIndex - spread); i < Math.min(windowSize / 2, midIndex + spread); i++) {
        sum += avg[i] * Math.exp(1 / (Math.abs(i - midIndex) + 1)) / Math.E;
    }
    return sum;
};
var avgResult = function(output) {
    _.each(output, function(band, index) {
        if (band) {
            //avg[index] = avg[index] * avgFactor + band * (1 - avgFactor);
            avg[index] = band;
        }
    });
};
var printSpectrum = function(output) {
    var bands = Array.apply(null, new Array(numBands)).map(Number.prototype.valueOf, 0);

    /*
    _.each(avg, function(band, index) {
        if (band) {
            bands[Math.round((index / (windowSize / 2)) * numBands)] += band;
        }
    });
    */
    for (var i = 0; i < numBands; i++) {
        bands[i] = getAmplitude(minF + (i / numBands) * (maxF - minF), (maxF - minF) / numBands);
    }
    /*
    _.each(bands, function(band, index) {
        var df = samplingRate / windowSize / 2;
        band = getAmplitude(df * (index / 
    });
    */

    /*
    process.stdout.write('\u001B[2J\u001B[0;0f');
    _.each(bands, function(band, index) {
        if (index > 32) {
            return;
        }
        var floored = Math.max(0, Math.floor(band * numBands / windowSize));
        console.log(floored ? Array(floored).join('=') : '');
    });
    */

    // cycle hue by approx. snare drum frequencies
    hue += getAmplitude(1200, 100) / 64;
    hue = hue % 360;

    // adjust intensity by approx. kick drum frequencies
    var intensity = getAmplitude(20, 50);
    imaxVal = Math.max(1, Math.max(imaxVal * dVal, intensity));
    //var ival = Math.max(0, Math.round((intensity * 2 - imaxVal) / (imaxVal) * 50));
    ival = ival * avgFactor + (1 - avgFactor) * (Math.exp(Math.pow(intensity / imaxVal, 2)) - 1) / (Math.E - 1) * 50;
    //minVal = Math.min(minVal * (2 - dVal), intensity);
    console.log();
    //console.log(minVal);

    console.log(ival);
    console.log(intensity);
    //socket.emit('color', 'hsl(' + Math.round(hue) + ', 100%, ' + Math.round(((intensity - minVal) / (imaxVal - minVal)) * 50) + '%)');
    socket.emit('color', 'hsl(' + Math.round(hue) + ', 100%, ' + Math.round(ival * 1000) / 1000 + '%)');
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
        /*
        _.each(output, function(band, index) {
            avg[index] = avgFactor * avg[index] + (1 - avgFactor) * band;
        });
        */

        avgResult(output);
        printSpectrum(avg);
    });
};

var spawn = Spawn({
    cmd: 'pacat',
    args: ['--record', '--raw', '--channels=1', '--format=s16le'],
    onStdout: runFFT
});

spawn.start();
