#!/bin/sh
cd /home/ec2-user/projects/proto
pwd;
echo;
echo Killing Chrome
pkill chrome
echo Stopping Server Server.js..;
forever stop Server.js;
echo;
echo Starting Server Server.js..;
forever start -a -l forever.log -o out.log -e err.log Server.js;
echo;
ps -ef | grep node;
echo;
forever list;
