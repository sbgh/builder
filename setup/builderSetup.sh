#!/bin/sh
#script to install node&npm then install unzip then download builder from github and unzip it into ./builder.
echo "~~~~~~~~~~~~~~~Builder Install~~~~~~~~~~~~~~~";
echo "This script will prompt to install Node.js & NPM ";
echo "then prompt to install unzip ";
echo "then download builder from github and unzip it into ./builder "
echo "then run ./setup/setup.sh script";
echo
while true; do
    read -p "Do you wish to continue? y/n " yn
    case $yn in
        [Yy]* ) echo "Install starting..";break;;
        [Nn]* ) echo "not installing Builder";exit;break;;
        * ) echo "Please answer y or n.";;
    esac
done

while true; do
    read -p "Do you wish to install Node.js v14 & NPM? y/n " yn
    case $yn in
        [Yy]* ) curl --silent --location https://rpm.nodesource.com/setup_14.x | sudo bash -; sudo yum -y install nodejs;break;;
        [Nn]* ) echo "not installing Node.js";break;;
        * ) echo "Please answer y or n.";;
    esac
done

while true; do
    read -p "Do you wish to install unzip?" yn
    case $yn in
        [Yy]* ) echo y | sudo yum install unzip;break;;
        [Nn]* ) echo "not installing unzip";break;;
        * ) echo "Please answer y or n.";;
    esac
done

mkdir builder;

curl https://codeload.github.com/sbgh/builder/zip/master > builder.zip;
unzip -oq builder.zip;
yes | cp -fr ./builder-master/* ./builder/;
rm -fr ./builder-master/;
chmod 700 ./builder/setup/setup.sh;

cd builder
./setup/setup.sh
