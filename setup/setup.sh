#!/bin/sh
echo
echo 'Installing NPM modules'
export npm_config_loglevel=error;
npm install express --save;
npm install express-session --save;
npm install session-file-store --save;
npm install password-hash --save;
npm install readline-sync --save;
sudo npm install -g forever --save;
npm install body-parser --save;
npm install child_process --save;
npm install formidable --save;
npm install ssh2 --save;
npm install getuid --save;
npm install ejs --save;
npm install chrome-remote-interface --save
npm install chrome-launcher --save
npm install
npm audit fix

echo
echo 'Creating identity folder & json'
mkdir ./identity;
npm install password-hash --save;
node ./setup/setAdminPw.js;
chmod 600 ./identity/identity.json;

echo
echo 'Creating sessions folder'
mkdir ./sessions;

echo
echo 'Creating results folder'
mkdir ./results;

echo
echo 'Creating upload folder'
unzip -oq ./uploads/uploads.zip -d ./uploads

echo
echo 'Creating library folders and files'
mkdir ./library;
mkdir ./library/public;
mkdir ./library/private;
mkdir ./library/public/library1;
mkdir ./library/private/library1;
mkdir ./library/public/library1/uploads;
mkdir ./library/private/library1/uploads;
echo "{}" > ./library/public/library1/SystemsJSON.json
echo "{}" > ./library/public/library1/BuildCode.json
echo "{}" > ./library/private/library1/SystemsJSON.json
echo "{}" > ./library/private/library1/BuildCode.json

echo
echo 'Creating backup folder'
mkdir ./backup;
mkdir ./backup/buildcode;

echo
echo 'Installing TinyMCE 5.1.1'
unzip -oq ./static/tinymce_5.1.1.zip -d ./static

echo
echo 'Creating SSL'
mkdir ./ssl;
openssl req -new -newkey rsa:4096 -days 365 -nodes -x509 -subj "/C=US/ST=Denial/L=Springfield/O=Dis/CN=www.example.com" -keyout ./ssl/server.key -out ./ssl/server.crt;

chmod 600  SystemsJSON.json;
echo
echo 'Installing headless Chrome'
chmod 700 ./setup/installChrome.sh;
while true; do
    read -p "Do you wish to install headless Chrome?" yn
    case $yn in
        [Yy]* ) ./setup/installChrome.sh;break;;
        [Nn]* ) echo "not installing headless Chrome";break;;
        * ) echo "Please answer y or n.";;
    esac
done

echo
echo 'Setting config'
node ./setup/setConfigJson.js;

chmod 700 restartServer.sh

echo
echo 'Setting Builder to start on reboot'
cronjob="@reboot /home/ec2-user/builder/restartServer.sh"
while true; do
    read -p "Do you wish to have Builder started automatically at reboot?" yn
    case $yn in
        [Yy]* ) (sudo crontab -u ec2-user -l; echo "$cronjob" ) | sudo crontab -u ec2-user - ;echo "cronjob created";break;;
        [Nn]* ) echo "Not setting to start automatically";break;;
        * ) echo "Please answer y or n.";;
    esac
done

echo
while true; do
    read -p "Do you wish to start /builder now?" yn
    case $yn in
        [Yy]* ) ./restartServer.sh;break;;
        [Nn]* ) echo "Not starting /builder";break;;
        * ) echo "Please answer y or n.";;
    esac
done
echo
echo /builder installation is complete!
echo /builder listens on port 8443. Ensure that you create a new inbound rule that allows port 8443.
echo You will access the /builder application via https://your.ip.address.or.hostname:8443/builder.
echo "You will encounter an error: ERR_CERT_AUTHORITY_INVALID because the https Certificate Authority (CA) is not valid (self-signed). Select advanced and proceed (add exception)"
echo The username is Admin and the password is the one you chose during installation.
echo You can start or restart the server by executing ./builder/restartServer.sh.
echo



