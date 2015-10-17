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

var MIN_BLOB_DETECTION_AREA = 80;
var RAD_PER_DEG = Math.PI / 180;

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
                servo: {driver: 'servo', pin: 12} //pin 18 is pin 12. makes sense. right?
            }
        },
        pilotConnection: {
            adaptor: 's3pilot',
            serialPort: ARDUINO_PORT,
            devices: {
                pilot: {
                    driver: 's3pilot',
                    geometry: {
                        ticksPerMeter: 320.01,
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

    commands: function () {
        return {
            setPower: this.setPower.bind(this),
            goDistance: this.goDistance.bind(this),
            setMotorPid: this.setMotorPid.bind(this),
            turnTo: this.turnTo.bind(this),
            begin: this.begin.bind(this)
        };
    },
    _waypoints: [],
    _nextWaypoint: null,

    begin: function(waypoints) {
        this._waypoints = waypoints;
        waypoints.forEach(function(waypoint) {
            waypoint._isCone = waypoint.isCone === 'true';
        });
        console.log('waypoints are set!')
        console.log(JSON.stringify(waypoints,null,'\t'));

        //this._nextWaypoint = this._waypoints.shift();
        this._state = 'nextWaypoint';
    },

    setPower: function (power) {
        console.log('setting power: ' + power);
        this.pilot.setMotorPower({
            M1: +power,
            M2: 0.0001
        });
    },

    goDistance: function (distance) {
        this.pilot.driveDistance({
            Dist: 1.01,
            Pwr: 40.01
        });
    },

    setMotorPid: function (kp, ki, kd, ke) {
        this.pilot.configure({
            mPID: [+kp, +ki, +kd, +ke]
        });
    },

    turnTo: function (pow, angle) {
        this.pilot.turnTo({
            Hdg: 0.01 + Number(angle),
            Pwr: 0.01 + Number(pow)
        });
    },

    getConeCenter: function () {
        var piData = shell.exec(PIXY_CMD, {silent: true}).output;
        var piSamples = JSON.parse(piData);

        var largestBlobArea = 0;
        var largestBlobX = null;

        piSamples.forEach(function (piSample) {
            piSample.forEach(function (blobString) {
                var height = /height: (\d+)/.exec(blobString)[1];
                var width = /width: (\d+)/.exec(blobString)[1];
                var x = /x: (\d+)/.exec(blobString)[1];

                var blobArea = height * width;

                if (blobArea > largestBlobArea && blobArea > MIN_BLOB_DETECTION_AREA) {
                    largestBlobX = x;
                    largestBlobArea = blobArea;
                }
            });
        });
        return {
            x: largestBlobX,
            area: largestBlobArea
        };
    },

    _sweepDirectionCompleted: false,

    _biggestBlobArea: 0,
    _biggestBlobServo: 76,
    _biggestBlobX: 0,

    sweep: function (my) {
        my._servoAngle += my._increment;
        my.servo.angle(my._servoAngle);

        console.log('servo angle: ' + my.servo.currentAngle());

        var coneCenter = my.getConeCenter();
        console.log('coneCenter');
        console.log(coneCenter);
        if (coneCenter && coneCenter.area) {
            console.log('cone spotted @x:' + coneCenter.x + ' area:' + coneCenter.area);

            my._sweepDirectionCompleted = false;
            my._state = 'follow';
            if(coneCenter.area > my._biggestBlobArea) {
                my._biggestBlobArea = coneCenter.area;
                my._biggestBlobServo = my._servoAngle;
                my._biggestBlobX = coneCenter.x;
            }
        }

        if ((my._servoAngle < 20) || (my._servoAngle > 130)) {
            my._increment *= -1;
            if (my._sweepDirectionCompleted) {
                my._whiffs++;
                if(my._whiffs > 5) {
                    console.log('cone not found. I give up.');
                    my._state = 'chill';
                } else {
                    my._state = 'getCloser';
                    my.pilot.driveDistance({
                        Dist: 0.9,
                        Hdg: my.angleTo(my._nextWaypoint),
                        Pwr: 40.1
                    });
                }
                my._sweepDirectionCompleted = false;
            }
            my._sweepDirectionCompleted = true;
        }
    },

    _waitingForTurn: false,
    _waitingForMove: false,
    follow: function (my) {

        //TODO: replace with ROTATE event
        if (my._waitingForTurn) {
            console.log('waiting for turn to: ' + my._desiredHeading);
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
        var servoCorrection = Math.floor((160 - x) / 10);
        my._servoAngle += servoCorrection;

        if (my._servoAngle < 20) {
            my._servoAngle = 20;
        }
        if (my._servoAngle > 130) {
            my._servoAngle = 130;
        }

        //we want my._servoAngle around 76
        var headingCorrection = (76 - my._servoAngle)/2;
        my._desiredHeading = my._pos.h + headingCorrection;

        //console.log('x: ' + x);
        //console.log('scorrection: ' + servoCorrection);
        //console.log('hcorrection: ' + headingCorrection);
        //console.log('area: ' + coneCenter.area);
        //console.log('desired heading: ' + my._desiredHeading);

        if (my._desiredHeading * 100 % 100 == 0) {
            //make sure we're using a decimal
            my._desiredHeading += 0.01;
        }
        my.servo.angle(my._servoAngle);

        var power = 10.1;
        if(coneCenter.area < 5000) {
            power = 40.1;
        }
        if(Math.abs(headingCorrection) < 10) {
            my.pilot.driveDistance({
                Dist: 0.2,
                Hdg: my._desiredHeading,
                Pwr: power
            })
        } else {
            my.pilot.turnTo({
                Hdg: my._desiredHeading,
                Pwr: 17.1
            });
            my._waitingForTurn = true;
        }
        console.log('servo angle: ' + my.servo.currentAngle());
    },

    _whiffs: 0,
    work: function (my) {

        // this is actually on 'push'. Just wired backwards
        my.button.on('release', function (evt) {
            console.log('bump!');
            this.pilot.driveDistance({
                Dist: 1.5,
                Pwr: -20.1
            });
            this._state = 'backup';
            my._whiffs = 0;
        }.bind(my));

        my.pilot.on('event', function (evt) {
            console.log('event!');
            console.log(evt);
            if(evt.Event === 'Rotate') {
                this._waitingForTurn = false;
                if(this._state === 'turnTo') {
                    this._state = 'straight';
                }
            }
            if(evt.Event === 'Move') {
                console.log('finished moving');
                console.log('isCone?' + this._nextWaypoint._isCone);
                this._waitingForMove = false;
                if (this._state === 'straight') {
                    if(this._nextWaypoint._isCone) {
                        this._state = 'sweep';
                    } else {
                        this._state = 'nextWaypoint';
                    }
                } else if (this._state === 'backup') {
                    this._state = 'nextWaypoint';
                } else if (this._state === 'getCloser') {
                    this._state = 'sweep';
                }
            }
        }.bind(my));

        my._lastPos = my._pos;

        // hPID: [Kp, Ki, Kd]
        //my.pilot.configure();//{hPID: [2, 0.8, 0.02]});
        every((0.2).second(), function () {
            //console.log('==state: '+my._state);

            my._pos = my.pilot.details.pose;
            my._lastPos = my._pos;

            //console.log('Pose:');
            //console.log(my._pos);

            switch (my._state) {
                case 'settling' :
                    console.log('settling');
                    console.log(my._pos);
                    my.settling(my);
                    break;
                case 'wait a tick':
                    my._state = 'chill';
                    break;
                case 'nextWaypoint':
                    my._nextWaypoint = my._waypoints.shift();
                    console.log('picking next waypoint: ');
                    console.log(my._nextWaypoint || 'JK. Alldone.');

                    if(my._nextWaypoint) {
                        my._state = 'turnTo';
                    } else {
                        my._state = 'chill';
                    }
                    break;
                case 'turnTo':
                    var angle = my.angleTo(my._nextWaypoint);
                    if(!my._waitingForTurn) {
                        my.pilot.turnTo({
                            Hdg: angle,
                            Pwr: 17.1
                        });
                        my._waitingForTurn = true;
                    }
                    break;
                case 'straight':
                    if(!my._waitingForMove) {
                        var distance = my.distanceTo(my._nextWaypoint);
                        if(my._nextWaypoint._isCone) {
                            distance -= 5;
                        }
                        console.log('driving distance: '+distance);
                        console.log('to a cone? '+my._nextWaypoint._isCone);
                        my.pilot.driveDistance({
                            Dist: distance,
                            Pwr: 40.01,
                            Hdg: my.angleTo(my._nextWaypoint)
                        });
                        my._waitingForMove = true;
                    }
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

    settling: function (my) {
        if (my._pos.h && my._pos.equals(my._lastPos)) {
            console.log('----------------ALL SETTLED----------------');
            //done settling
            my._state = 'wait a tick';
            //my.pilot.configure({mPID: [10, 0.8, 0.02]});
            my.pilot.enableMotors();
            my.pilot.reset();
        }
    },

    angleTo: function(pos) {
        return this.angleBetween(this._pos, pos);
    },
    distanceTo: function(pos) {
        return this.distanceBetweenPos(this._pos, pos);
    },

    angleBetween: function (lhs, rhs) {
        var x = rhs.x - lhs.x;
        var y = rhs.y - lhs.y;
        var theta = Math.atan(x / y);

        if (y < 0) {
            theta += Math.PI;
        }

        return this.radToDegrees(theta);
    },
    distanceBetweenPos: function(lhs, rhs) {
        var x = rhs.x - lhs.x;
        var y = rhs.y - lhs.y;

        return Math.sqrt(x*x + y*y);
    },
    radToDegrees: function(theta) {
        return theta / RAD_PER_DEG;
    }



});

Cylon.start();