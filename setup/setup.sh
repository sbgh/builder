#!/bin/sh
echo
echo 'Installing NPM modules'
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
npm install chrome-remote-interface
npm install chrome-launcher

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
mkdir ./uploads;

echo
echo 'Creating SSL'
mkdir ./ssl;
openssl req -new -newkey rsa:4096 -days 365 -nodes -x509 -subj "/C=US/ST=Denial/L=Springfield/O=Dis/CN=www.example.com" -keyout ./ssl/server.key -out ./ssl/server.crt;
echo 'backing up system json if it exists'
cp SystemsJSON.json SystemsJSON.json.$(date +"%Y%m%d%H%M");
echo 'Creating System json'
echo '{}' > SystemsJSON.json;
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

echo /builder installation is complete!
echo /builder listens on port 8443. Ensure that you create a new inbound rule that allows port 8443.
echo You will access the /builder application via https://your.ip.address.or.hostname/builder.
echo "You will encounter an error: ERR_CERT_AUTHORITY_INVALID because the https Certificate Authority (CA) is not valid (self-signed). Select advanced and proceed (add exception)"
echo The username is Admin and the password is the one you chose during installation.
echo You can start or restart the server by executing ./builder/restartServer.sh.
echo

while true; do
    read -p "Do you wish to start /builder now?" yn
    case $yn in
        [Yy]* ) ./restartServer.sh;break;;
        [Nn]* ) echo "Not starting /builder";break;;
        * ) echo "Please answer y or n.";;
    esac
done





