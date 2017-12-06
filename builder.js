const express = require("express");
const http = require('http');
const https = require('https');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bodyParser = require("body-parser");
const execSync = require('child_process').execSync;
const passwordHash = require('password-hash');
const Client = require('ssh2').Client;
const getuid = require('getuid');
const formidable = require('formidable');
const chromeLauncher = require('chrome-launcher');
const CDP = require('chrome-remote-interface');

var app = express();
var fs = require('fs');


var router = express.Router();
var viewPath = __dirname + '/views/';
var resultsPath = __dirname + '/results/';
var filesPath = __dirname + '/uploads/';

const cf = fs.readFileSync('config.json');
const config = JSON.parse(cf);

app.use(session({
        store: new FileStore, // ./sessions
        secret: config.session_secret,
        resave: true,
        saveUninitialized: true,
        name:config.session_name
    }));

app.use(express.static('static'));

// all templates are located in `/views` directory
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');


//***************************************************************************************************
const SystemsJSONContents = fs.readFileSync('SystemsJSON.json');
global.SystemsJSON = JSON.parse(SystemsJSONContents);

global.Page = '';
global.protocol='';
global.chrome='';
(async function () {
    async function launchChrome() {
        return await chromeLauncher.launch({
            chromeFlags: ["--disable-gpu", "--headless", "--enable-logging", "--no-sandbox"]
        });
    }
    chrome = await launchChrome();
    console.log('Chrome debugging port running on ' + chrome.port);

    const viewport = [1600,1200];

    protocol = await CDP({
        port: chrome.port
    });

    Page = protocol.Page;
    const {DOM, Emulation, Runtime} = protocol;
    await Promise.all([Page.enable(), Runtime.enable(), DOM.enable()]);

    var device = {
        width: viewport[0],
        height: viewport[1],
        deviceScaleFactor: 1,
        mobile: false,
        fitWindow: true
    };

    // set viewport and visible size
    await Emulation.setDeviceMetricsOverride(device);
    await Emulation.setVisibleSize({width: viewport[0], height:viewport[1]});

    await Page.navigate({url: 'http://google.com'});
    await Page.loadEventFired();

})();

var userTable = fs.readFileSync("./identity/identity.json");
var userTableJSON = JSON.parse(userTable);

app.use(bodyParser.json({limit: '10mb'}));
app.use(bodyParser.urlencoded({limit: '10mb', extended: true}));

router.use(function (req,res,next) {
    var log = "{"+"date:"+new Date().toISOString().replace(/T/, '_').replace(/:/g, '-')+",";

    log +=  "md:" + req.method + ",url:'" + req.url+"',";
    log += "rfr:" + req.headers.referer + ",rad:" + req.connection.remoteAddress+"}\n"
    fs.appendFile('accesslog.txt', log, function (err) {
        if (err) throw err;
        //console.log('Saved!');
    });
    next();
});

router.get("/",function(req,res){
    res.end('')
});

router.get("/login",function(req,res){
    res.render('login');
});

router.post("/login",function(req,res) {

    console.log("login - referrer:" + req.headers.referer + ' remoteAddress:' + req.connection.remoteAddress);
    if (req.body.username === "" || req.body.password === "") {
        res.render('login', {error: "ERROR: Please enter userID & password"});
    }else{
        var userJSON = userTableJSON.filter(function (row) {
            return row.id === req.body.username;
        });
        if (!passwordHash.isHashed( userJSON[0].pw)){
            console.log('username not found - referrer:' + req.headers.referer + ' connection:' + req.connection.remoteAddress + " username:" + req.body.username);
            res.render('login', {error: "ERROR: User identity not setup."});
        }else{

            if (passwordHash.verify(req.body.password, userJSON[0].pw)) {
                req.session.authenticated = true;
                req.session.username = "Admin";

                const redirectTo = req.body.rd ? req.body.rd : '/';

               // console.log('redirecting to: ' + redirectTo);
               // console.log('req.body.rd ' + req.body.rd);
                res.redirect(redirectTo);
            } else {
                console.log('Login credentials incorrect - referer:' + req.headers.referer + ' connection:' + req.connection.remoteAddress + " username:" + req.body.username);
                res.render('login', {error: "Login credentials incorrect"});
            }
        }
    }

});

//-------------------All routes below require authentication-----------------------------------------------------
router.get("/*",function(req,res,next) {
    var sess = req.session; //Check if authenticated
    if (!sess.authenticated) {
        //console.log("/login?rd=" + encodeURIComponent(req.url));
        res.redirect("/login?rd=" + encodeURIComponent(req.url));
    }else{
        next();
    }
});

router.get('/logout', function (req, res) {
    delete req.session.authenticated;
    delete req.session.username;
    res.redirect('/');
});

router.get("/builder",function(req,res){
    var sess = req.session;
    res.render("builder", {username: sess.username});
});

router.get("/Jobs",function(req,res){
    //console.log("url: " + req.url);
    var id = req.query.id[0];
    //console.log("jobs:" + id+":");
    res.writeHead(200, {"Content-Type": "application/json"});
    var resJSON = [];
    if (id !== '#'){
        var rowdata = SystemsJSON[id];
        //console.log('gv:' + SystemsJSON[id].variables);
        rowdata.id = id;
        resJSON.push(rowdata);
    }else{
        for (var key in SystemsJSON) {
            if (SystemsJSON.hasOwnProperty(key)) {
                var rowdata = SystemsJSON[key];
                rowdata.id = key;
                resJSON.push(rowdata);
            }
        }
    }
    res.end(JSON.stringify(resJSON));
});

router.get("/Sys",function(req,res){
    //console.log("url: " + req.url);
    var id = req.query.id[0];
    //console.log("jobs:" + id+":");
    res.writeHead(200, {"Content-Type": "application/json"});
    var resJSON = [];
    if (id !== ''){
        var rowdata = SystemsJSON[id];
        rowdata.id = id;
        resJSON.push(rowdata);
        //console.log("resJSON.id = " + resJSON.id);
        res.end(JSON.stringify(resJSON));
        //console.log(JSON.stringify(resJSON));
    }else{
        res.end("");
    }
});

router.post("/remove",function(req,res){
    //remove id from systems json and remove /uploads/ dir
    var reqJSON= req.body;
    var ids =reqJSON.ids.split(';');

    ids.forEach(function(id) {
        if(SystemsJSON.hasOwnProperty(id)) {
           delete SystemsJSON[id]; //delete from main datastore
           saveAllJSON();
           rmDir(filesPath + id + "/"); //delete all uploaded files
            fs.readdir(resultsPath, function(err, files){ // delete results files
               // console.log(files);
                if (err){
                    console.log(err);
                }else{
                    files.forEach(function(mFile){
                        if (mFile.substr(0,36) === id){
                            if (fs.statSync(resultsPath + mFile).isFile()){
                                //console.log("removing: " + resultsFilesPath + mFile);
                                fs.unlinkSync(resultsPath + mFile);
                            }
                        }
                    })
                }

            });
        }
    });

    res.end('');
});

function rmDir(dirPath) { //sync remove dir
    try { var files = fs.readdirSync(dirPath); }
    catch(e) { return; }
    if (files.length > 0)
        for (var i = 0; i < files.length; i++) {
            var filePath = dirPath + '/' + files[i];
            if (fs.statSync(filePath).isFile())
                fs.unlinkSync(filePath);
            else
                rmDir(filePath);//recursive
        }
    fs.rmdirSync(dirPath);
};

router.get("/move",function(req,res){
    //console.log("move...");
    var id = req.query.id[0];
    var direction = req.query.direction[0];

    //console.log(id+":"+direction);

    if(id === '' || direction === ''){
        res.end('');
    }

    var parent = SystemsJSON[id].parent;
    // var sysAr = [];

    var x =0;
    var beforeId = '';
    var posId = ''
    var afterId = '';
    // var pos = 0;
    for (var key in SystemsJSON) {
        if (parent === SystemsJSON[key].parent) {
            if (afterId === '') {
                if (beforeId !== '') {
                    afterId = key;
                }
                if (key === id) {
                    beforeId = lastId;
                    posId = key;
                }
                var lastId = key;
            }
            SystemsJSON[key].sort = x;
            x++;
        }
    }

    var newPos = SystemsJSON[posId].sort;
    if(direction === 'u' && beforeId !== ''){
        //console.log('direction:' + direction);
        var tmp = SystemsJSON[posId].sort;
        SystemsJSON[posId].sort = SystemsJSON[beforeId].sort;
        SystemsJSON[beforeId].sort = tmp;
        newPos = SystemsJSON[posId].sort;
    }

    if(direction === 'd' && afterId !== ''){
        //console.log('direction:' + direction);
        var tmp = SystemsJSON[posId].sort;
        SystemsJSON[posId].sort = SystemsJSON[afterId].sort;
        SystemsJSON[afterId].sort = tmp;
        newPos = SystemsJSON[posId].sort;
    }

    var SystemsArr_sorted = [],i;
    for(i in SystemsJSON){
        if(SystemsJSON.hasOwnProperty(i)){
            SystemsArr_sorted.push([i,SystemsJSON[i]]);
        }
    }

    SystemsArr_sorted.sort(function(a,b){
        return a[1].sort > b[1].sort ? 1 : -1;
    })

    var SystemsJson_sorted = {};
    for (var i=0; i < SystemsArr_sorted.length; i++){
        SystemsJson_sorted[SystemsArr_sorted[i][0]] = SystemsArr_sorted[i][1];
    }

    SystemsJSON = SystemsJson_sorted;

    saveAllJSON();

    res.writeHead(200, {"Content-Type": "application/json"});
    res.end(JSON.stringify({newPos:newPos}));

});

router.get("/getResults",function(req,res) {
    var fileName = req.query.id;
    var results = fs.readFileSync(resultsPath + fileName + ".json");
    res.end(results)
});

function checkIfFile(file, cb) {
    fs.stat(file, function fsStat(err, stats) {
        if (err) {
            if (err.code === 'ENOENT') {
                return cb(null, false);
            } else {
                return cb(err);
            }
        }
        return cb(null, stats.isFile());
    });
};

router.get("/resultsList",function(req,res){
    var id = req.query.id[0];
    res.writeHead(200, {"Content-Type": "application/json"});
    fs.readdir(resultsPath, function (err, files) {
        if (err) {
            throw err;
        } else {
            var resultsFileArray = [];
            files = files.filter(function (file) {
                return (file.substr(0, id.length) == id);
            });
            files = files.sort(function(a, b)
            {
                var ap = b.split('_')[1];
                var bp = a.split('_')[1];
                return ap == bp ? 0 : ap < bp ? -1 : 1;
            });//sort dec
            files.forEach(function (file) {
                //console.log(file);
                resultsFileArray.push({file: file.substring(0, file.indexOf('.'))});
            });
            res.end(JSON.stringify(resultsFileArray));
        }
    });
});

router.post("/saveId",function(req,res){

    var sess = req.session;
    var userId = sess.username;

    var reqJSON = req.body;
    var pw1 = reqJSON.newPassword;
    var pw2 = reqJSON.newPasswordAgain;
    if(pw1 !== pw2){
        res.end("Passwords are not the same")
    }else if(pw1.length < 8){
        res.end("Password is less then 8 Chrs.")
    }else{
        //var passwordHash = require('password-hash');
        for (var x in userTableJSON) {
            if (userTableJSON[x].id === userId) {
                userTableJSON[x].pw = passwordHash.generate(pw1);
                saveAllIdentJSON();
                res.end("Password saved");
                break;
            }
        }
    };
});

router.post("/save",function(req,res){
    //console.log("submit");

    var reqJSON = req.body;
    var id = reqJSON.id;
    var foundRow = {};
    //console.log("type: "+req.body.type);
    if(req.body.type !== "system"){
        var type = "job";
        if (id.length < 32){ //new
            var pid = req.body.parent[0];
            var parentFamTree = SystemsJSON[pid].ft;
            var x =0;
            for (var key in SystemsJSON) {
                if (SystemsJSON[key].parent === pid) {
                    x++;
                }
            }

            id = generateUUID();
            foundRow = {parent:pid, ft:parentFamTree+'/'+pid, name:req.body.name, ver:1,enabled:0, type: 'disabled', description: req.body.description, script:req.body.script, variables:req.body.compVariables, template:req.body.template, text:req.body.name, resourceFiles:{}, sort:x};
            SystemsJSON[id] = foundRow;
        }else{ //not new
                var newData = {};
                newData.parent = SystemsJSON[id].parent;;
                newData.ft = SystemsJSON[id].ft;
                newData.name = req.body.name;
                newData.enabled = req.body.enabled;
                if(req.body.enabled === 1){
                    newData.type = 'job'
                }else{
                    newData.type = 'disabled'
                }
                //newData.type = type;
                newData.description = req.body.description;
                newData.variables = req.body.compVariables;
                newData.script = req.body.script;
                newData.template = req.body.template;
                newData.text = req.body.name;
                newData.custTemplates = req.body.custTemplates;
                newData.resourceFiles = req.body.resourceFiles;
                newData.sort = SystemsJSON[id].sort;

            if ( SystemsJSON[id].hasOwnProperty('ver') ) {
                newData.ver = SystemsJSON[id].ver + 1;
            }else{
                newData.ver = 1;
            }

                SystemsJSON[id] = newData;
                foundRow = SystemsJSON[id];
               // console.log('v:' + req.body.compVariables)
        }
    }else{
        var type = "system";
        if (id.length < 32){ //new
            var pid = '#';
            var x =0;
            for (var key in SystemsJSON) {
                if (SystemsJSON[key].parent === pid) {
                    x++;
                }
            }
            id = generateUUID();
            foundRow = {parent:pid, ft:pid, name:req.body.name, ver:1, type: type, description: req.body.description, text:req.body.name, variables:req.body.variables, sort:x};
            SystemsJSON[id] = foundRow;
        }else{ //not new
            var newData = {};
            newData.parent = SystemsJSON[id].parent;
            newData.ft = SystemsJSON[id].ft;
            newData.name = req.body.name;
            newData.type =  req.body.type;
            newData.description = req.body.description;
            newData.text = req.body.name;
            newData.variables = req.body.variables;
            newData.sort = SystemsJSON[id].sort;
            newData.icon = SystemsJSON[id].icon;

            if ( SystemsJSON[id].hasOwnProperty('ver') ) {
                newData.ver = SystemsJSON[id].ver + 1;
            }else{
                newData.ver = 1;
            }

            SystemsJSON[id] = newData;
            foundRow = SystemsJSON[id];
        }
    }

    if (reqJSON.hasOwnProperty('iconURL')){
        var base64Data = reqJSON.iconURL.replace(/^data:image\/png;base64,/, "");
        //console.log("base64Data: "+base64Data);
        if (base64Data !== '') {
            //console.log("base64Data !== '' - "+base64Data);
            var iconPath = filesPath + id + '/' + "icon.png";
            foundRow.icon = "/uploads/" + id + '/' + "icon.png";
            SystemsJSON[id].icon = "/uploads/" + id + '/' + "icon.png";
            //console.log(iconPath);
            if (!fs.existsSync(filesPath + id)) {
                fs.mkdirSync(filesPath + id)
            }
            fs.writeFileSync(iconPath, base64Data, 'base64');
        }
    }

    //console.log("icon: "+SystemsJSON[id].icon);

    saveAllJSON();
    //res.sendStatus(200);
    res.writeHead(200, {"Content-Type": "application/json"});
    foundRow.id = id;
    res.end(JSON.stringify(foundRow));
    //console.log("saving script"+ JSON.stringify(foundRow));

}); // and New

function generateUUID() { // Public Domain/MIT
    var d = new Date().getTime();
    if (typeof performance !== 'undefined' && typeof performance.now === 'function'){
        d += performance.now(); //use high-precision timer if available
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (d + Math.random() * 16) % 16 | 0;
        d = Math.floor(d / 16);
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

router.post("/copy",function(req,res){
    var type = "disabled";
    var reqJSON= req.body;

    var fromIds =reqJSON.ids.split(';');
    var targetId = reqJSON.parent;

    var error = false;
    var errorID = '';
    if (!SystemsJSON.hasOwnProperty(targetId) && error == false ){
        error = true;
        errorID = targetId;
    }
    fromIds.forEach(function(id){
        if (!SystemsJSON.hasOwnProperty(id) && error === false ){
           error = true;
           errorID = id;
        }
    });

    if(error === false){
        var idMap = {};
        idMap[SystemsJSON[fromIds[0]].parent] = SystemsJSON[targetId].id;

        //var resultRows = {};
        fromIds.forEach(function(fromId) {
            var fromNode = SystemsJSON[fromId];
            var id = generateUUID();

            idMap[fromId] = id;
            var newParentId = idMap[SystemsJSON[fromId].parent]
            //console.log('move to:'+SystemsJSON[newParentId].name);
            var NewRow = {
                parent: newParentId,
                ft: SystemsJSON[newParentId].ft + '/' + newParentId,
                name: fromNode.name,
                description: fromNode.description,
                ver: 1,
                type: fromNode.type,
                text: fromNode.name
            };
            if(fromNode.type === 'job' || fromNode.type === 'disabled'){
                NewRow.enabled=fromNode.enabled;
                NewRow.script=fromNode.script;
                NewRow.variables=fromNode.variables;
                NewRow.template=fromNode.template;
                NewRow.custTemplates=fromNode.custTemplates;
                NewRow.resourceFiles=fromNode.resourceFiles;
            }else{
                NewRow.icon=fromNode.icon.replace(fromId, id);
            }

            SystemsJSON[id] = NewRow;

            if ( fs.existsSync( filesPath + fromId ) ) { //copy file resources if they exist
                fs.mkdirSync(filesPath + id);
                files = fs.readdirSync(filesPath + fromId);
                files.forEach(function (file) {
                    if (!fs.lstatSync(filesPath + fromId + '/' + file).isDirectory()) {
                        var targetFile = filesPath + id + '/' + file;
                        var source = filesPath + fromId + '/' + file;
                        fs.writeFileSync(targetFile, fs.readFileSync(source))
                    }
                })
            }
        });
        saveAllJSON();

        res.sendStatus(200);
        res.end('');
        //console.log("saving script"+ JSON.stringify(foundRow));

    }else{
        res.sendStatus(500);
        res.end("Error:System ID not found - " + errorID)
    }



});

function getSystemVarVal(jobId, vari){
    //console.log('jobId: '+jobId);
    if (SystemsJSON.hasOwnProperty(jobId)){
        var ft = SystemsJSON[jobId].ft;
        var sysId = ft.split('/')[1];
        var varListAr = SystemsJSON[sysId].variables.split('\n');
        //console.log(varListAr);
        var returnVal = '';
        varListAr.forEach(function(pair){
            var vName = pair.split('=')[0];
            if (vName === vari){
                returnVal = pair.split('=')[1];
            }
        });
        return(returnVal)
    }else{
        return('');
    }

};

/*
var GIFEncoder = require('gifencoder');
var base64 = require('base64-stream');
var encoder = new GIFEncoder(854, 480);
var PNGDecoder = require('png-stream/decoder');
var concat = require('concat-frames');
var neuquant = require('neuquant');


var sendCast = true;
router.get("/stream",function(req,res){
    // res.setHeader('Connection', 'Transfer-Encoding');
    //   res.setHeader('Content-Type', 'image/gif');
    // res.setHeader('Transfer-Encoding', 'chunked');

    var stream = require('stream');
    // Initiate the source
    var bufferStream = new stream.PassThrough();

    (async function () {

        await Page.startScreencast({format: 'png', everyNthFrame: 5});
        let counter = 0;
        while(counter < 100){
            const {data, metadata, sessionId} = await Page.screencastFrame();
            console.log(counter);

            // Write your buffer
                    //bufferStream.end(new Buffer(data));
            bufferStream.write(new Buffer(data,'base64'));              //.toString('binary')

            //res.write(data);
            await Page.screencastFrameAck({sessionId: sessionId});
            counter++;
        }
        bufferStream.write('');
        res.end('')
    })();
    //Pipe it to gif encoder then response
                    //   bufferStream
    fs.createReadStream('/home/ec2-user/projects/proto/static/images/3dCloudIBM2.png')
                            //             .pipe(base64.decode())
            .pipe(new PNGDecoder)

                        //   .pipe(new neuquant.Stream)

                             //   .pipe(encoder.createWriteStream({ repeat: -1, delay: 500, quality: 10 }))
            .pipe(res);
                             //    .pipe(fs.createWriteStream('myanimated.gif'));


});

*/

var latestResultsFileList = [];
router.post("/run",function(req,res){
    //console.log("running");

    var job;
    var jobIndex;

    var ids;
    var storeLocal;
    var runKey="";
    var newKey=false;

    var conn;
    var timeOut = 300000;  //how many ms all connections should wait for the prompt to reappear before connection is terminated
    var lastTimeout;
    var exportVar = "";

    var form = new formidable.IncomingForm();
    form.parse(req, function(err, fields, files) {
        if(err){
            console.log(err);
            //message(err);
        }else{
            ids = fields.ids.split(';');

            storeLocal = fields.storeLocal;
            if(files.hasOwnProperty('key')   ){
                var myFiles = files['key'];

                if (myFiles.hasOwnProperty('path')) {
                    runKey = fs.readFileSync(myFiles.path);
                    newKey = true;
                    fs.unlink(myFiles.path,function(err){
                        console.log('Error: unable to delete uploaded key file');
                    });
                   //console.log('runKey file: ' + runKey);
                }
            }else{
                if(storeLocal = 'yes'){
                    if(fields.hasOwnProperty('localStoredKey')){
                        runKey = fields.localStoredKey;
                        //console.log('runKey local: ' + runKey);
                    }
                }
            }
        }
    });

    form.multiples = false;
    form.uploadDir = __dirname;

    // log any errors
    form.on('error', function(err) {
        console.log('An error has occured.\n/run \n' + err);
    });

    // once form is uploaded, run 1st component
    form.on('end', function() {
        res.setHeader('Connection', 'Transfer-Encoding');
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        if(runKey.toString() !== '' && newKey === true){
            res.write("key:"+runKey.toString().split('\n').join('key:') );
        }

        var disabledIds = [];
        ids.forEach(function(id){
            if(SystemsJSON[id].enabled !== 1){
                disabledIds.push(id);
            }else if (disabledIds.indexOf(SystemsJSON[id].parent) !== -1){
            //((SystemsJSON[SystemsJSON[id].parent].enabled !== 1) && (SystemsJSON[SystemsJSON[id].parent].type !== "system")){
                disabledIds.push(id);
            }
        });
        var y = 0;
        var nameList = [];
        disabledIds.forEach(function(id){
            var i = ids.indexOf(id);
            ids.splice(i,1);
            y++;
            if(y < 4){
                nameList.push(SystemsJSON[id].name);
            }
            if(y === 4){
                nameList.push("...");
            }
        });
        if(y>0){
            res.write( "Skipping " + y.toString() + " disabled components (" + nameList.join(', ') + ")");
        }
        var id = ids[0];
        //console.log("running: "+ ids);
        jobIndex = 0;
        if (SystemsJSON.hasOwnProperty(id)){
            job = SystemsJSON[id];
                runScript(id, job ,"SSH");
        }else{
            console.log("Error: /run id not found in SystemsJSON: "+ id);
        }
    });

    function conTimeout () {
        console.log('SSH2 conn timed out ' + timeOut.toString());
        conn.end();
     }

    function runScript(jobId, job, runMethod) {
        var script = job.script;
        var scriptArray = script.split("\n");

        latestResultsFileList = getLatestResultsFileList(); //cache the list of results files to make var lookups quicker
        function getLatestResultsFileList() {
            var files = fs.readdirSync(resultsPath);  //!!Sync
            files = files.sort(function (a, b) //sort by id_time desc
            {
                var ap = b;
                var bp = a;
                return ap == bp ? 0 : ap < bp ? -1 : 1;
            });//sort dec

            var lastID = '';
            files = files.filter(function (file) {
                if (file.split('_')[0] !== lastID) {
                    lastID = file.split('_')[0];
                    return (true)
                } else {
                    return (false)
                }
            }); //include most resent of each id

            return (files);
        }

        if (runMethod === "exec") {
            scriptArray.forEach(function (item) {
                // var cmd = item;
                // exec(cmd, function (error, stdout, stderr) {
                //     //console.log("out:" + stdout);
                //     //res.write(stdout);
                //     res.end(stdout)
                // });
            });
        } //experimental

        if (runMethod === "SSH") {
            var sshSuccess = false;
            //var Client = require('ssh2').Client;
            conn = new Client();
            //var username = 'SysStackUser';
            var resultsArray = [];
            var exportCommand = "";
            var messQueue = [];

            message('-----Building: ' + job.name+'-----');
            function message(mess) {
                messQueue.push(mess)
            }
            function flushMessQueue() {
                var ds = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-');
                messQueue.forEach(function (mess) {
                    resultsArray.push({
                        t: ds,
                        m: mess
                    });
                    res.write("message:" + mess + "\n")
                });
                messQueue = [];
            }

            conn.on('error', function (err) {
                console.log('SSH - Connection Error: ' + err);
                message('SSH - Connection Error: ' + err);
            });

            conn.on('end', function () {
                //console.log('SSH - Connection Closed');
                //console.log('conn end, jobIndex: ' + jobIndex);
                if (ids.length > jobIndex + 1) {
                    jobIndex++;
                    id = ids[jobIndex];

                    if (SystemsJSON.hasOwnProperty(id)) {
                        //    console.log("\nrunning: "+ SystemsJSON[id].name);
                        if (sshSuccess) {
                            var job = SystemsJSON[id];

                                runScript(id, job ,"SSH");

                        } else {
                            flushMessQueue();
                            res.write("message:Script Aborted\n");
                            res.end("**Scripts Aborted**");
                        }
                    } else {
                        console.log("Error: /run id not found in SystemsJSON: " + id);
                    }
                } else {
                    if (sshSuccess) {
                        res.end("**All scripts completed**");
                        //console.log("**All scripts completed**")
                    } else {
                        flushMessQueue();
                        res.write("message:Script Aborted\n");
                        res.end("**Scripts Aborted**");
                    }
                }
            });

            conn.on('ready', function () {


                var commandIndex = 0;
                var prompt = "[SysStack]";
                var atPrompt = false;
                var aSyncInProgress = 0;
                var deferredExit = false;
                conn.shell(function (err, stream) {
                    if (err) throw err;

                    stream.on('close', function (code, signal) {
                        var dsString = new Date().toISOString();

                        writeCloseResponse(sshSuccess === true ? "CompletionSuccess:true\n" : "CompletionSuccess:false\n", dsString);
                        clearTimeout(lastTimeout);
                        //sshSuccess = true;

                        message("Completed " + job.name);
                        flushMessQueue();

                        var fds = dsString.replace(/_/g, '-').replace(/T/, '-').replace(/:/g, '-').replace(/\..+/, '');
                        var fileName = "";
                        if (sshSuccess === true) {
                            fileName = resultsPath + job.id + '_' + fds + '_p.json';
                        } else {
                            fileName = resultsPath + job.id + '_' + fds + '_f.json';
                        }

                        fs.writeFile(fileName, JSON.stringify(resultsArray), function (err) {
                            if (err) {
                                console.log('There has been an error saving your json.');
                                console.log(err.message);
                                //return;
                            }
                            //console.log('json saved successfully.')
                        });
                        function writeCloseResponse(newData, dsString) {
                            var endStr = newData.toString() + 'code: ' + code + '\nsignal: ' + signal + '\n';
                            res.write(endStr);
                            var ds = dsString.replace(/T/, '_').replace(/:/g, '-');
                            resultsArray.push({t: ds, x: "", results: endStr});
                        }

                        conn.end();
                    });
                    stream.on('data', function (data) {

                        writeResponse(data);

                        if (commandIndex < scriptArray.length) {
                            var command = scriptArray[commandIndex];
                            var currentCommand = replaceVar(command, job);

//see if building a list of async tasks and sending to manager is worth trying...
                            //console.log('\n1 aSyncInProgress:', aSyncInProgress, command);
                            processDirectives();
                            if (commandIndex < scriptArray.length) {
                                sendCommand();
                            }
                            //console.log('2 aSyncInProgress:', aSyncInProgress);
                        }

                        if (commandIndex === scriptArray.length) {
                            commandIndex++;

                            if (aSyncInProgress < 1){
                                stream.write("exit" + '\n');
                                sshSuccess = true
                            }else{
                                message('Waiting for asynchronous processes to complete...');
                                deferredExit = true
                            }
                            flushMessQueue();

                            //console.log('Exiting...');
                        }

                        function writeResponse(newData) {

                            var ds = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-');
                            messQueue.forEach(function (mess) {
                                resultsArray.push({
                                    t: ds,
                                    m: mess
                                });
                                res.write("\nmessage:" + mess + "\n")
                            });
                            messQueue = [];

                            var newdataStr = newData.toString();
                            res.write(newdataStr);

                            newdataStr = newdataStr.replace(/\n$/, "");
                            var newdataAr = newdataStr.split('\n');

                            newdataAr.forEach(function (row) {
                                if (row === prompt) {
                                    atPrompt = true;
                                } else {
                                    if (atPrompt == true) {
                                        resultsArray.push({
                                            t: ds,
                                            x: atPrompt === true ? '' : exportVar,
                                            results: prompt + row + '\n'
                                        });
                                    } else {
                                        resultsArray.push({
                                            t: ds,
                                            x: atPrompt === true ? '' : exportVar,
                                            results: row + '\n'
                                        });
                                    }
                                    atPrompt = false;
                                }
                            });
                            resultsArray.push({t: ds, x: '', cc: newData});
                        }

                        function sendCommand() {
                            if (data.slice(-(prompt.length)).toString() === prompt) {
                                exportVar = '';
                                exportCommand = '';
                                if (currentCommand.substr(0, 7) === "export:") {
                                    exportVar = currentCommand.substr(currentCommand.indexOf(":") + 1);
                                    currentCommand = exportVar.substr(exportVar.indexOf(":") + 1);
                                    exportVar = exportVar.substr(0, exportVar.indexOf(":"));
                                    exportCommand = currentCommand;
                                }
                                //console.log('sent  [' + currentCommand + " \n ex:" + exportVar +'\n data:'+ data.toString() + ']');

                                //console.log('sent :' + currentCommand);
                                stream.write(currentCommand + '\n');
                                commandIndex++;
                            }
                        }

                        function processDirectives(){
                            do{
                                // console.log("commandIndex: " + commandIndex);
                                // console.log("process:" + currentCommand);
                                // console.log("");

                                var isDirective = false;
                                //console.log(currentCommand);

                                if (currentCommand.substr(0, 7) === "noWait:") {
                                    currentCommand = currentCommand.substr(currentCommand.indexOf(":") + 1);
                                    stream.write(currentCommand + '\n');

                                    isDirective = true;
                                } else if
                                (currentCommand.substr(0, 3) === "^c:") {
                                    stream.write("\x03");
                                    isDirective = true;
                                    //console.log('send ^c');
                                } else if
                                (currentCommand.substr(0, 10) === "setPrompt:") {
                                    prompt = currentCommand.substr(currentCommand.indexOf(":") + 1);
                                    //console.log('set prompt [' + prompt + ']');
                                    isDirective = true;
                                } else if
                                (currentCommand.substr(0, 15) === "setPromptCodes:") {
                                    promptCodes = currentCommand.substr(currentCommand.indexOf(":") + 1);
                                    var codesAr = promptCodes.split(" ");
                                    var codePrompt = "";
                                    codesAr.forEach(function (code) {
                                        codePrompt += String.fromCharCode(parseInt(code, 16));
                                    });
                                    prompt = codePrompt;
                                    //console.log('set promptCodes [' + codePrompt + ']');
                                    isDirective = true;
                                } else if
                                (currentCommand.substr(0, 13) === "saveTemplate:") {

                                    var template = job.template;
                                    var pathFileName = currentCommand.substr(currentCommand.indexOf(":") + 1);
                                    var tempNum = parseInt(currentCommand.split(':')[1], 10);
                                    if (tempNum > 1 && tempNum < 100) {
                                        template = job.custTemplates['template' + tempNum.toString()];
                                        pathFileName = currentCommand.substr(currentCommand.indexOf(":") + 1);
                                        pathFileName = pathFileName.substr(pathFileName.indexOf(":") + 1);
                                    }

                                    var pathFileNameAr = pathFileName.split('/');
                                    var fileName = pathFileNameAr[pathFileNameAr.length - 1];
                                    var rmResp = execSync("sudo rm -f /tmp/" + fileName);

                                    sendTemplate(pathFileName, fileName, template);
                                    function sendTemplate(aPathFileName, aFileName, aTemplate){
                                        aSyncInProgress++;
                                        fs.writeFile('/tmp/' + aFileName, aTemplate, function (err) {
                                            if (err) {
                                                aSyncInProgress--;
                                                return console.log(err);
                                            }
                                            var chownResp = execSync("sudo chown " + getSystemVarVal(jobId, 'username') + ":" + getSystemVarVal(jobId, 'username') + ' /tmp/' + aFileName);
                                            conn.sftp(
                                                function (err, sftp) {
                                                    //var msg = "";
                                                    if (err) {
                                                        console.log("Error, problem starting SFTP: %s", err);
                                                        message('error:saveTemplate - problem starting SFTP');
                                                        stream.close();
                                                        aSyncInProgress--;
                                                    } else {
                                                        var readStream = fs.createReadStream("/tmp/" + aFileName);
                                                        var writeStream = sftp.createWriteStream(pathFileName);
                                                        //console.log('creating write stream' + aFileName);
                                                        writeStream.on('error', function (e) {
                                                            aSyncInProgress--;
                                                            console.log('error:saveTemplate - error creating target stream - ' + aPathFileName, e);
                                                            message('error:saveTemplate - error creating target stream - ' + aPathFileName);
                                                            stream.close();
                                                        });

                                                        writeStream.on('close', function () {
                                                                aSyncInProgress--;
                                                                //console.log('saveTemplate:Sent - ' + aFileName);
                                                                sftp.end();
                                                                message('saveTemplate:send complete - ' + aPathFileName);
                                                                var rmResp = execSync("sudo rm -f /tmp/" + aFileName);
                                                                if(deferredExit == true && aSyncInProgress == 0){
                                                                    stream.write("exit" + '\n');
                                                                    sshSuccess = true
                                                                }
                                                            }
                                                        );
                                                        readStream.pipe(writeStream);
                                                    }
                                                }
                                            )
                                        })
                                    }

                                    isDirective = true;
                                } else if
                                (currentCommand.substr(0, 9) === "saveFile:") {

                                    var fileName = currentCommand.split(':')[1].trim();
                                    var remotePath = currentCommand.split(':')[2].trim();

                                    var foundErr = false;
                                    if (fileName.trim() === "" || remotePath.trim() === "") {
                                        //console.log("Error saving resource file. Please provide file name and path");
                                        message('error:saveFile - Please provide file name and path');
                                        stream.close();
                                    }

                                    if (!fs.existsSync(filesPath + job.id + '/' + fileName)) {
                                        console.log("Error saving resource file. File resource not found.");
                                        //foundErr = true;
                                        message('error:Resource not found - ' + filesPath + job.id + '/' + fileName);
                                        stream.close();
                                    } else {
                                        aSyncInProgress++;
                                        sendFile(fileName, remotePath, job.id);
                                        function sendFile(aFileName, aRemotePath, aJobID) {
                                            conn.sftp(
                                                function (err, sftp) {
                                                    //    var msg = "";
                                                    if (err) {
                                                        console.log("Error, problem starting SFTP:", err);
                                                        message('error:problem starting SFTP - ' + filesPath + aJobID + '/' + aFileName);
                                                        aSyncInProgress--;
                                                        stream.close();
                                                        // msg = "Error, problem starting SFTP" + '\n';
                                                        // stream.write(msg);
                                                    } else {
                                                        //console.log("file sftp: " + filesPath + aJobID + '/' + aFileName + ' > ' + aRemotePath + '/' + aFileName);
                                                        var readStream = fs.createReadStream(filesPath + aJobID + '/' + aFileName);

                                                        var writeStream = sftp.createWriteStream(remotePath + '/' + aFileName);
                                                        writeStream.on('error', function (e) {
                                                            //console.log(e);
                                                            message('error:saveFile - error creating target stream - ' + aRemotePath + '/' + aFileName);
                                                            aSyncInProgress--;
                                                            stream.close();
                                                        });

                                                        writeStream.on('close', function () {
                                                            sftp.end();
                                                            message('saveFile:send complete - ' + aRemotePath + '/' + aFileName);
                                                            aSyncInProgress--;
                                                            if(deferredExit == true && aSyncInProgress == 0){
                                                                stream.write("exit" + '\n');
                                                                sshSuccess = true
                                                            }
                                                        });
                                                        readStream.pipe(writeStream);

                                                    }
                                                }
                                            )
                                        }
                                    }

                                    isDirective = true;
                                } else if
                                (currentCommand.substr(0, 5) === "snap:") {

                                    var url = currentCommand.replace('snap:','').trim();
                                    //console.log('url: ' + url);
                                    aSyncInProgress++;
                                    (async function () {

                                        await Page.navigate({url: url});
                                        await Page.loadEventFired();

                                        setTimeout(async function() {
                                            const ss = await Page.captureScreenshot({format: 'png', fromSurface: true});
                                            if (!fs.existsSync(filesPath + job.id)) {
                                                fs.mkdirSync(filesPath + job.id)
                                            }
                                            fs.writeFileSync(filesPath + job.id + '/' + 'screenshot.png', ss.data, 'base64');

                                            res.write("img:"+job.id + '/' + 'screenshot.png');
                                            // protocol.close();
                                            // chrome.kill();
                                            // console.log('chrome killed');

                                            aSyncInProgress--;
                                            //console.log('saveTemplate:Sent - screenshot.png' );
                                            message('snap:created: ' + "screenshot.png" + ":"+ 'url:' + url);
                                            if(deferredExit == true && aSyncInProgress == 0){
                                                stream.write("exit" + '\n');
                                                sshSuccess = true
                                            }
                                        }, 1000);
                                    })();
                                    isDirective = true;

                                } else if
                                (currentCommand.substr(0, 6) === "abort:") {

                                    message('Abort directive called');
                                    stream.close();

                                    isDirective = true;
                                }

                                if (isDirective === true) {
                                    commandIndex++;
                                    if (commandIndex < scriptArray.length){
                                        command = scriptArray[commandIndex];
                                        currentCommand = replaceVar(command, job);
                                    }  else{
                                        isDirective = false;
                                    }
                                }
                            }while(isDirective === true);

                         }

                        function replaceVar(commandStr, job) {// find and replace inserted vars eg. <%0ae3461e-d3c3-4214-acfb-35f44199ab5c.mVar4%>
                            //console.log("-"+commandStr+"-");
                            var items = commandStr.split(new RegExp('<%', 'g'));
                            items.forEach(function (item) {
                                item = item.substr(0, item.indexOf('%>'));

                                if (item.length > 2 && item.length < 32 && item.substr(0, 2) == 'c.') {
                                    var targetVarName = item.substr(2);
                                    var pid = job.parent;
                                    var repStr = "<%c." + targetVarName + "%>";
                                    job.variables.split('\n').forEach(function (v) {
                                        if (v.split('=')[0] === targetVarName){
                                            var val = v.substr(v.indexOf('=')+1);
                                            commandStr = commandStr.replace(repStr, val)
                                        }
                                    })
                                }
                                ; //look in job for vars

                                if (item.length > 2 && item.length < 32 && item.substr(0, 2) == 'p.') {
                                    var targetVarName = item.substr(2);
                                    var pid = job.parent;
                                    var repStr = "<%p." + targetVarName + "%>";
                                    latestResultsFileList.forEach(function (file) {
                                        if (file.substr(0, 36) === pid) {
                                            var val = getVarValFromFile(file, targetVarName);

                                            commandStr = commandStr.replace(repStr, val)
                                        }
                                    })
                                }
                                ; //look in parent for vars

                                if (item.length > 2 && item.length < 32 && item.substr(0, 2) == 'a.') {
                                    var targetVarName = item.substr(2);
                                    var pid = job.parent;
                                    var repStr = "<%a." + targetVarName + "%>";
                                    var anArr = job.ft.replace('#/', '').split('/');
                                    anArr.reverse().forEach(function (an) {
                                        latestResultsFileList.forEach(function (file) {
                                            if (file.substr(0, 36) === an) {
                                                var val = getVarValFromFile(file, targetVarName);
                                                if (val !== '') {
                                                    commandStr = commandStr.replace(repStr, val)
                                                }
                                            }
                                        })
                                    })//reverse the ansester list so that closer ansesters values are used first.
                                }
                                ; //look in ancestors for vars

                                if (item.length > 2 && item.length < 32 && item.substr(0, 2) == 's.') {
                                    var targetVarName = item.substr(2);
                                    var ft = job.ft;
                                    var repStr = "<%s." + targetVarName + "%>";

                                    latestResultsFileList.forEach(function (file) {
                                        var id = file.substr(0, 36);
                                        if (SystemsJSON.hasOwnProperty(id)) {
                                            var resultsSystem = SystemsJSON[id].ft.split('/')[1];
                                            var val = getVarValFromFile(file, targetVarName);
                                            if (val !== '' && (ft.split('/')[1] == resultsSystem)) {
                                                commandStr = commandStr.replace(repStr, val)
                                            }
                                        }
                                    })
                                }
                                ; //look in same system for vars

                                if (item.length > 37 && item.length < 67 && item.split("-").length == 5 && item.substr(14, 1) == '4' && item.substr(36, 1) == '.') {
                                    var targetVarName = item.substr(37);
                                    var id = item.substr(0, 36);
                                    var repStr = "<%" + id + "." + targetVarName + "%>";

                                    latestResultsFileList.forEach(function (file) {
                                        if (file.substr(0, 36) === id) {
                                            var val = getVarValFromFile(file, targetVarName);
                                            commandStr = commandStr.replace(repStr, val);
                                        }
                                    });
                                }
                                ;

                            });

                            return (commandStr);
                        }

                        function getVarValFromFile(file, targetVarName) {
                            var results = JSON.parse(fs.readFileSync(resultsPath + file));
                            var trimmedResults = '';
                            results.forEach(function (row) {
                                if (row.hasOwnProperty('results')) {
                                    if (row.results.substr(0, 4) === 'var:') {
                                        var varName = row.results.split(':')[1];
                                        if (varName === targetVarName) {
                                            trimmedResults += row.results.substr(('var:' + varName + ':').length)
                                        }
                                    }
                                }
                                if (row.hasOwnProperty('x') && row.x !== '') {
                                    varName = row.x;
                                    if (varName === targetVarName) {
                                        trimmedResults += row.results
                                    }
                                }
                            });
                            return (trimmedResults.replace(/\n$/, "").replace(/\r$/, ""));
                        }
                    });
                    stream.stderr.on('data', function (data) {
                        clearTimeout(lastTimeout);
                        console.log('STDERR: ' + data);
                        res.end('STDERR: ' + data);
                    });

                    //first command
                    stream.write('stty cols 200' + '\n' + "PS1='[SysStack]'" + '\n');
                    lastTimeout = setTimeout(conTimeout, timeOut);
                });
            });

            //console.log('job.id: ' + jobId);
            //console.log('username: ' + getSystemVarVal(jobId, 'username'));
            conn.connect({
                host: getSystemVarVal(jobId, 'host'),
                port: getSystemVarVal(jobId, 'port'),
                username: getSystemVarVal(jobId, 'username'),
                privateKey: runKey
            });
        }
    }
});

router.get("/getVars",function(req,res){
    res.writeHead(200, {"Content-Type": "application/json"});

    //var resultsFileArray = {};
    fs.readdir(resultsPath, function (err, files) {
        if (err) {
            throw err;
        } else {
            //var resultsFileArray = [];
            files = files.sort(function(a, b) //sort by id_time desc
            {
                var ap = b;
                var bp = a;
                return ap == bp ? 0 : ap < bp ? -1 : 1;
            });//sort dec

            var lastID = '';
            files = files.filter(function (file) {
                if (file.split('_')[0] !== lastID){
                    lastID = file.split('_')[0];
                    return (true)
                }else{
                    return (false)
                }
            }); //include most resent of each id

            //console.log(files);
            var listOfVars = {};
            var listOfVarsIndex = [];
            files.forEach(function (file) {

                var id = file.split('_')[0];
                if(SystemsJSON.hasOwnProperty(id)){
                    var name = SystemsJSON[id].name;
                    var ftRaw = SystemsJSON[id].ft;
                    var ftAr = ftRaw.split('/');
                    var t = [];
                    ftAr.forEach(function(id){
                        if (id !== '#'){
                            t.push(SystemsJSON[id].name)
                        }
                    })//convert id/id/... to name/name/... for fam tree
                    var ft = t.join('/');

                    var results = JSON.parse(fs.readFileSync(resultsPath + file));
                    results.forEach(function(row){
                        if ( row.hasOwnProperty('results') && row.results.substr(0,4) === 'var:'){
                            varName = row.results.split(':')[1];
                            var trimmedResults= row.results.substr(('var:' + varName + ':').length);
                            insertResultsArr(trimmedResults, varName, listOfVars);
                        }
                        if(row.hasOwnProperty('x') && row.x !== ''){
                            varName = row.x;
                            var trimmedResults= row.results;
                            insertResultsArr(trimmedResults, varName, listOfVars);
                        }
                    });
                    function insertResultsArr(trimmedResults, varName, listOfVars){
                        if (listOfVars.hasOwnProperty(id+':'+varName)){
                                listOfVars[id+':'+varName] = {'id':id, 'path': ft+'/'+name,'ft':ftRaw, 'link':id, 'varName':varName, 'row' : listOfVars[id+':'+varName].row + trimmedResults};
                        }else{
                            listOfVars[id+':'+varName] = {'id':id, 'path': ft+'/'+name,'ft':ftRaw, 'link':id, 'varName':varName, 'row' : trimmedResults};
                            listOfVarsIndex.push({id:id, pathRaw: ftRaw+'/'+id, path:ft+'/'+name, varName:varName});
                        }
                    }
                }
            });

            listOfVarsIndex = listOfVarsIndex.sort(function(a, b){
                if(a.path.toUpperCase() == b.path.toUpperCase()){
                    return 0
                }else if(a.path.toUpperCase() < b.path.toUpperCase()){
                    return -1
                }else{
                    return 1
                }
            });//sort by path

            var newListOfVars = {};
            listOfVarsIndex.forEach(function(row){
                newListOfVars[row.id+':'+row.varName] = listOfVars[row.id+':'+row.varName]
            });

           // console.log(JSON.stringify(listOfVars));
            res.end(JSON.stringify(newListOfVars));
        }
    })
});

router.get("/fileList",function(req,res){
    //res.writeHead(200, {"Content-Type": "application/json"});
    var id = req.query.id;
    //console.log("id: "+id);
    fs.readdir(filesPath + id + '/' , function(err, files){
        if(err || (id.trim() === '') || (id.indexOf('..') > 0) ){
            res.end(JSON.stringify([]));
            console.log(err);
        }else{
            var returnArr = [];
            files.forEach(function(file){
                returnArr.push({name:file})
            })
            res.end(JSON.stringify(returnArr))
        }
    })
});

router.post("/upload",function(req,res){ //https://coligo.io/building-ajax-file-uploader-with-node/

    // create an incoming form object;
    var form = new formidable.IncomingForm();

    form.parse(req, function(err, fields, files) {

        if(err){
            res.end(err)
        }

        var id = fields.id;
        if (SystemsJSON.hasOwnProperty(id)){
            if (!fs.existsSync(filesPath +id)) {
                fs.mkdirSync(filesPath +id);
            }
            var myFiles = files['uploads[]'];
            if(Array.isArray(myFiles)){
                myFiles.forEach(function(file){
                    fs.renameSync(file.path, filesPath + id + '/' + file.name)
                })
            }else{
                fs.renameSync(myFiles.path,  filesPath + id + '/' + myFiles.name)
            }
            fs.readdir(filesPath + id + '/' , function(err, files){
                if(err){
                    res.end(err)
                }else{
                    var returnArr = [];
                    files.forEach(function(file){
                        returnArr.push({name:file})
                    })
                    res.end(JSON.stringify(returnArr))
                }

            })
        }else{
            res.end("/upload error: id not found in SystemsJSON: " + id)
        }
    });
    form.multiples = true;
    form.uploadDir = filesPath;

    // form.on('file', function(field, file) {
    //    // fs.rename(file.path, form.uploadDir +'/' + file.name);
    // });
    // form.on('field', function(field, value) {
    //    // id=value;
    // });

    // log any errors that occur
    form.on('error', function(err) {
        console.log('An error has occured.\n/upload \n' + err);
    });

    // once all the files have been uploaded, send a response to the client
    form.on('end', function() {
       // res.end('success');
    });
});

router.get("/uploads/*",function(req,res){

    var link = req.originalUrl;
    if (link.indexOf("?") > 0 ){
       link = link.split("?").shift();
    }

    if (fs.existsSync(__dirname + link)) {
        var fileStream = fs.createReadStream(__dirname + link);
        fileStream.pipe(res);
    }else{
        res.end('')
    }

});

router.get("/delFiles",function(req,res){
    var id = req.query.id;
    var filesBlob = req.query.files.split(';');
    if (fs.existsSync(filesPath +id) && id.length > 32) {

        filesBlob.forEach(function(myFile){
            if (myFile.trim().length > 0){
                try{
                    fs.unlinkSync(filesPath + id + '/' + myFile);
                }catch(err){
                    message("error removing file: " + myFile.trim())
                }

            }
        })
        fs.readdir(filesPath + id + '/' , function(err, files){
            if(err){
                res.end(err)
            }else{
                var returnArr = [];
                files.forEach(function(file){
                    returnArr.push({name:file})
                })
                res.end(JSON.stringify(returnArr))
            }

        })
    }
});

function saveAllJSON(){

    fs.writeFile('SystemsJSON.json', JSON.stringify(SystemsJSON), function (err) {
        if (err) {
            console.log('There has been an error saving your json.');
            console.log(err.message);
            return;
        }
        //console.log('json saved successfully.')
    })
};

function saveAllIdentJSON(){
    fs.writeFile('./identity/identity.json', JSON.stringify(userTableJSON), function (err) {
        if (err) {
            console.log('There has been an error saving your identity json.');
            console.log(err.message);
            return;
        }
       // console.log('identity saved successfully.')
    });
};

app.use("/",router);

app.use("*",function(req,res){
    res.sendFile(viewPath + "404.html");
    console.log('404 '+ req.baseUrl)
});

//ca: fs.readFileSync('./ssl/ca.crt'),
var secureServer = https.createServer({
    key: fs.readFileSync('./ssl/server.key'),
    cert: fs.readFileSync('./ssl/server.crt'),
    requestCert: true,
    rejectUnauthorized: false
}, app).listen('8443', function() {
    console.log("Secure Express server listening on port 8443");
});

// http.createServer(app).listen('8080');
// console.log("Express server listening on port 8080");


