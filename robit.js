/*global process, require, console, every, setInterval, clearInterval */
var ARDUINO_PORT = '/dev/ttyACM0';

//TODO: Turn this into a cylon thingamajiggy. a device? a connection?

var serialport = require('serialport');
var SerialPort = serialport.SerialPort;

var Pose = function (x, y, h) {
    this.x = x;
    this.y = y;
    this.h = h;
    console.log('new pose: '+x+','+y+','+h);
};
Pose.fromMessage = function(msg) {
    if (msg && msg.T === 'Pose') {
        return new Pose(msg.X,msg.Y,msg.H);
    }
    return null;
};

var Pilot = function (pilotSerialPort) {

    this.arduinoSerialPort = {};
    this.connected = false;
    this.connectionInterval = 0;
    this.motorsEnabled = false;

    this.setConnectionInterval();
    
    this.pose = new Pose(0,0,0);
};

Pilot.prototype = {
    setConnectionInterval: function () {
        if (!this.connectionInterval) {
            this.connectionInterval = setInterval(function (my) {
                return function () {
                    my.connectToArduino();
                };
            }(this), 2000);
        }
    },
    disconnect: function() {
        if(this.arduinoSerialPort) {
            this.arduinoSerialPort.close();
        }
    },
    initSerialPort: function () {
        var my = this;
        //TODO: change ARDUINO_PORT
        this.arduinoSerialPort = new SerialPort(ARDUINO_PORT, {
            baudrate: 115200,
            parser: serialport.parsers.readline('\n')
        }, false);

        this.arduinoSerialPort.on('data', function (data) {
            try {
                var msg = JSON.parse(data);
                //TODO: add a msg router
                if (msg && msg.T === 'Pose') {
                    this.pose = Pose.fromMessage(msg);
                } else {
                    console.log(data);
                }
            } catch (err) {
                // Wasn't a JSON msg. Still could be interesting.

                var MOTOR_OUT_REGEX = /M(\d)$/;
                if (!data.match(MOTOR_OUT_REGEX)) {
                    console.error(data);
                }
            }
        });
        this.arduinoSerialPort.on('close', function () {
            my.setConnectionInterval();
        });
    },
    connectToArduino: function () {
        var my = this;
        try {
            this.initSerialPort();
            this.arduinoSerialPort.open(function (error) {
                if (error) {
                    console.log('Failed to connect to Pilot Board!\n' + error);
                    if (my.connected) {
                        my.arduinoSerialPort.close();
                    }
                    my.setConnectionInterval();
                } else {
                    clearInterval(my.connectionInterval);
                    my.connectionInterval = 0;
                    my.connected = true;
                    console.log('Connected to Arduino.');
                    //TODO: move to pilot.onConnect event handler;
                    //my.enableMotors();
                }
            });
        } catch (err) {
            console.log('Couldn\'t connect to Arduino on port ' +
                ARDUINO_PORT + '. Do you have permission?');
            console.error(err);
        }
    },
    sendSerial: function (msg) {
        if (this.arduinoSerialPort && this.connected) {
//            console.log('SERIAL OUT:');
//            console.log(msg);
//            console.log({"Topic": "Cmd/robot1", "Cmd": "Power", "T": "Cmd", "Value": -20});
            this.arduinoSerialPort.write(JSON.stringify(msg) + '\n');
        }
    },
    enableMotors: function () {
        if (!this.motorsEnabled && this.connected) {
            console.log('Enabling motors');
            this.sendSerial({
                "Topic": "Cmd/robot1",
                "T": "Cmd",
                "Cmd": "Esc",
                "Value": 1
            });
            this.motorsEnabled = true;
        }
    }
};

//TODO: Does Cylon handle this for me?
process.on('SIGINT', function() {
    console.log('disconnecting from PilotBoard');
    pilot.disconnect();
    process.exit();
});

var pilot = new Pilot();



var Cylon = require('cylon');
Cylon.api('http', {
    ssl: false,
    host: '0.0.0.0',
    //    serveDir: '../robeaux'
});

Cylon.robot({
    name: 'cylon_magellan',
    INPUT: {

    },

    connections: {
        joystick: {
            adaptor: 'joystick'
        },
        loopback: {
            adaptor: 'loopback'
        }
    },

    devices: {
        controller: {
            driver: 'dualshock-3'
        },
        ping: {
            driver: 'ping'
        }
    },
    work: function (my) {
        my.controller.details.leftStick = 0;
        my.controller.details.rightStick = 0;

        ['square', 'circle', 'x', 'triangle'].forEach(function (button) {
            my.controller.on(button + ':press', function () {
                console.log('Button ' + button + ' pressed.');
            });

            my.controller.on(button + ':release', function () {
                console.log('Button ' + button + ' released.');
            });
        });

        my.controller.on('left_y:move', function (pos) {
            my.controller.details.leftStick = pos;
        });

        my.controller.on('right_y:move', function (pos) {
            my.controller.details.rightStick = pos;
        });

        var idleFor = 0; //how many cycles have we been idel for?
        every((0.1).second(), function () {
            var leftPower = Math.floor(my.controller.details.leftStick * 100);
            var rightPower = Math.floor(my.controller.details.rightStick * 100);

            var idle = Math.abs(leftPower) < 10 && Math.abs(rightPower) < 10;
            if (idle && idleFor < 10) {
                idleFor++;
            }
            if (!idle) {
                idleFor = 0;
                pilot.enableMotors();
                console.log('at power L:' + leftPower + '%\tR:' + rightPower);
            } else {
                leftPower = 0;
                rightPower = 0;
            }
            //TODO: method for this
            var msg = {
                "Topic": "Cmd/robot1",
                "Cmd": "Power",
                "T": "Cmd",
                "Value": leftPower
            };
            
            if (idleFor < 10) {
                pilot.sendSerial(msg);
            }
        });
    }
});

Cylon.start();