
const fs = require('fs');

var prompt = require('readline-sync');
var secret ='';
var username ='';

while (secret.length < 20){
    console.log('');
    secret = prompt.question('Enter random chrs for session secret. Must be at least 20 chrs: ');
}

while (username.trim().length < 5){
    console.log('');
    username = prompt.question('Enter your preferred username. Must be at least 5 chrs: ');
}

var configJSON = {};
configJSON.session_secret=secret;
configJSON.session_name='connectec2.sid';

configJSON.currentStyle="default";
configJSON.timeout=30000;
configJSON.noClientTimeout="10";
configJSON.username=username.trim();

fs.writeFile('./config.json', JSON.stringify(configJSON), function (err) {
    if (err) {
        console.log('ERROR: There has been an error saving your config json.');
        console.log(err.message);
    }else{console.log('config.json saved')}
});
