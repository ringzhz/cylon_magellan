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
    //serveDir: '../robeaux'
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
                        ticksPerMeter: 240.01,
                        mMax: 452.1
                    },
                    //ahrsCalibration: {
                    //    a_x: -2114,
                    //    a_y: -578,
                    //    a_z: 566,
                    //    g_x: 92,
                    //    g_y: -7,
                    //    g_z: 53
                    //},
                    mPID: [0.005, 0.0000010, 0.0000010, 100.1]
                    //hPID: [0.5, 0.0000010, 0.0000010, 100.1]
                }
            }
        },
        button: {
            adaptor: 'raspi',
            pin: 38, //physical: 21, OS: 9
            devices: {
                button: {
                    pin: 38,
                    driver: 'button'
                }
            }
        }
    },

    commands: function() {
        return {
            setPower:   this.setPower.bind(this),
            goDistance: this.goDistance.bind(this),
            setMotorPid: this.setMotorPid.bind(this),
            turnTo: this.turnTo.bind(this)
        };
    },

    setPower: function(power) {
        console.log('setting power: '+power);
        this.pilot.setMotorPower({
            M1: +power,
            M2: 0.0001
        });
    },

    goDistance: function(distance) {
        this.pilot.driveDistance({
            Dist: 1.01,
            Pwr: 40.01
        });
    },

    setMotorPid: function(kp, ki, kd, ke) {
        this.pilot.configure({
            mPID: [+kp, +ki, +kd, +ke]
        });
    },

    turnTo: function(pow, angle) {
        this.pilot.turnTo({
            Hdg: 0.01+Number(angle),
            Pwr: 0.01+Number(pow)
        });
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
        var coneCenter = my.getConeCenter();
        if (coneCenter && coneCenter.area) {
            console.log('cone spotted @x:'+coneCenter.x+' area:'+coneCenter.area);
            my._state = 'follow';
        }
    },

    follow: function(my) {
        console.log('FOLLOWING');
        if(my._desiredHeading && Math.abs(my._desiredHeading - my._pos.h) > 5) {
            console.log('waiting for turn to: '+my._desiredHeading);
            return;
        }
        var coneCenter = my.getConeCenter();
        var x = coneCenter.x;
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
        my._desiredHeading = my._pos.h + (76 - my._servoAngle)/2;
        console.log('x: ' +x);
        console.log('correction: ' +correction);
        console.log('desired heading: ' + my._desiredHeading);
        my.pilot.turnTo({
            Hdg: my._desiredHeading
        });
        my.servo.angle(my._servoAngle);
        console.log('servo angle: '+my.servo.currentAngle());
    },

    work: function (my) {

        // this is actually on 'push'. Just wired backwards
        my.button.on('release', function(evt) {
            console.log('bump!');
            this._state = 'backup';
        }.bind(my));

        // hPID: [Kp, Ki, Kd]
        //my.pilot.configure();//{hPID: [2, 0.8, 0.02]});
        every((0.5).second(), function () {
            //console.log('==state: '+my._state);

            my._lastPos = my._pos;
            my._pos = my.pilot.details.pose;

            //console.log('Pose:');
            //console.log(my._pos);

            switch(my._state) {
                case 'settling' :
                    console.log('settling');
                    console.log(my._pos);
                    my.settling(my);
                    break;
                case 'wait a tick':
                    my._state = 'straight';
                    break;
                case 'straight':
                    my._state = 'chill';
                    break;
                case 'sweep':
                    my.sweep(my);
                    break;
                case 'follow':
                    my.follow(my);
                    break;
                case 'chill':
                    break;
            }

        });


    },

    settling: function(my) {
        if(my._pos.h && my._pos.equals(my._lastPos)) {
            console.log('----------------ALL SETTLED----------------');
            //done settling
            my._state = 'wait a tick';
            //my.pilot.configure({mPID: [10, 0.8, 0.02]});
            my.pilot.enableMotors();
            my.pilot.reset();
        }
    }



});

Cylon.start();