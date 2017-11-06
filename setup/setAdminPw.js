const passwordHash = require('password-hash');
const fs = require('fs');
var prompt = require('readline-sync');


var p1='';
var p2='';

while ((p1 === '') || (p1 !== p2) || (p1.length < 8)){
    console.log('');
    //console.log('Enter new Admin password to log into builder. Must be at least 8 chrs.');


    p1 = prompt.question('Enter new Admin password to log into builder. Must be at least 8 chrs: ');
    p2 = prompt.question('Enter new password again: ');

    if (p1 !== p2){console.log('Passwords do not match')};
    if (p1.length < 8){console.log('Passwords must be at least 8 chrs.')};
}

var newPW = passwordHash.generate(p1);

var userTableJSON = [{}];
userTableJSON[0].id='Admin';
userTableJSON[0].pw=newPW;

fs.writeFile('./identity/identity.json', JSON.stringify(userTableJSON), function (err) {
    if (err) {
        console.log('There has been an error saving your identity json.');
        console.log(err.message);
    }else{console.log('identity.json saved')}
});


