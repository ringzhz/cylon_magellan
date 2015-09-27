/* global require, console, every */
/* jshint node:true */
var ARDUINO_PORT = '/dev/ttyACM0';

var Cylon = require('cylon');

//var sleep = require('sleep').sleep;
//
//var Promise = require("bluebird");
//
//var rasp2c = require('rasp2c');

var shell = require('shelljs');

var PIXY_CMD = '/home/pi/workspace/pixy/build/hello_pixy/hello_pixy';

Cylon.api('http', {
    ssl: false,
    host: '0.0.0.0',
    serveDir: '../robeaux'
});

Cylon.robot({
    name: 'cylon_magellan',
    _state: 'settling',
    _servoAngle: 40,
    _increment: 10,
    _pos: {},
    _lastPos: null,
    connections: {
        arduino: {
            adaptor: 'raspi',
            devices: {
                servo: { driver: 'servo', pin: 12 } //pin 18 is pin 12. makes sense. right?
            }
        },
        pilotConnection: {
            adaptor: 's3pilot',
            serialPort: ARDUINO_PORT,
            devices: {
                pilot: {
                    driver: 's3pilot',
                    geometry: {
                        ticksPerMeter: 240,
                        mMax: 450
                    }/*,
                    ahrsCalibration: {
                        a_x: -2114,
                        a_y: -578,
                        a_z: 566,
                        g_x: 92,
                        g_y: -7,
                        g_z: 53
                    }*/
                }
            }
        }
    },


    getConeCenter: function() {
        var piData = shell.exec(PIXY_CMD, {silent:true}).output;
        var piSamples = JSON.parse(piData);

        var largestBlobArea = 0;
        var largestBlobX = null;

        piSamples.forEach(function(piSample) {
            piSample.forEach(function(blobString) {
                var height = /height: (\d+)/.exec(blobString)[1];
                var width = /width: (\d+)/.exec(blobString)[1];
                var x = /x: (\d+)/.exec(blobString)[1];

                var blobArea = height * width;

                if(blobArea > largestBlobArea && blobArea > 400) {
                    largestBlobX = x;
                }
            });
        });
        return largestBlobX;
    },

    sweep: function(my) {
        my._servoAngle += my._increment;
        if ((my._servoAngle < 20) || (my._servoAngle > 130)) { my._increment *= -1; }
        my.servo.angle(my._servoAngle);
        console.log('servo angle: '+my.servo.currentAngle());
        var x = my.getConeCenter();
        if (x) {
            my._state = 'follow';
        }
    },

    follow: function(my) {
        console.log('FOLLOWING');
        var x = my.getConeCenter();
        if (!x) {
            console.log('cone lost! sweeping again.');
            my._state = 'sweep';
            return;
        }

        //we want x to be 160;
        var correction = Math.floor((160 - x)/10);
        my._servoAngle += correction;

        if(my._servoAngle < 20) {
            my._servoAngle = 20;
        }
        if(my._servoAngle > 130) {
            my._servoAngle = 130;
        }

        //we want my._servoAngle around 76
        var desiredHeading = my._pos.h + 76 - my._servoAngle;
        console.log('x: ' +x);
        console.log('correction: ' +correction);
        console.log('desired heading: ' +desiredHeading);
        my.pilot.turnTo({
            Hdg: desiredHeading
        });
        my.servo.angle(my._servoAngle);
        console.log('servo angle: '+my.servo.currentAngle());
    },

    work: function (my) {
        my.pilot.enableMotors();
        every((0.5).second(), function () {
            console.log('==state: '+my._state);

            console.log('Pose:');
            console.log(my._pos);

            switch(my._state) {
                case 'settling' :
                    my.settling(my);
                    break;
                case 'sweep':
                    my.sweep(my);
                    break;
                case 'follow':
                    my.follow(my);
                    break;
            }

        });
    },

    settling: function(my) {
        my._lastPos = my._pos;
        my._pos = my.pilot.details.pose;
        if(my._pos.h && my._pos.equals(my._lastPos)) {
            console.log('ALL SETTLED');
            //done settling
            my._state = 'sweep';
            my.pilot.reset();
        }
    }



});

Cylon.start();