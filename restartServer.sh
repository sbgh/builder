#!/bin/sh

#upgrade builder
cd ~
curl https://codeload.github.com/sbgh/builder/zip/master > builder.zip;
unzip -oq builder.zip;
yes | cp -fr ./builder-master/SystemsJSON.json ./builder/SystemsJSON.json;
yes | cp -fr ./builder-master/BuildCode.json ./builder/BuildCode.json;
yes | cp -fr ./builder-master/builder.js ./builder/builder.js;
yes | cp -fr ./builder-master/views/* ./builder/views/;
yes | cp -fr ./builder-master/uploads/* ./builder/uploads/;
yes | cp -fr ./builder-master/static/* ./builder/static/;
yes | cp -fr ./builder-master/setup/* ./builder/setup/;
unzip -oq ./builder/uploads/uploads.zip -d ./builder/uploads;

#launch builder
cd ~/builder;

#bug
mkdir ./backup/buildcode

pwd;
echo;
echo Stopping server builder.js..;
forever stop builder.js;
echo;
echo Starting Server builder.js..;
forever start -a -l forever.log -o out.log -e err.log builder.js;
echo;
ps -ef | grep node;
echo;
forever list;
