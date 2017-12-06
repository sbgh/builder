#!/bin/sh
pwd;
echo;
echo Killing Chrome
pkill chrome
echo Stopping server builder.js..;
forever stop builder.js;
echo;
echo Starting Server builder.js..;
forever start -a -l forever.log -o out.log -e err.log builder.js;
echo;
ps -ef | grep node;
echo;
forever list;
