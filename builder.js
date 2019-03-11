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

const app = express();
const fs = require('fs');
const os = require('os')

const router = express.Router();
const viewPath = __dirname + '/views/';
const resultsPath = __dirname + '/results/';
const filesPath = __dirname + '/uploads/';
const libsPath = __dirname + '/library/';
const stylesPath = __dirname + '/static/theme/';
const treeStylesPath = __dirname + '/static/jstree/dist/themes/';

//Load configs
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

const homedir = require('os').homedir();
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
    //console.log("error: " + req.query.error);
    //console.log("rd: " + req.query.rd);
    res.render('login', {error: req.query.error});
});

router.post("/login",function(req,res) {

    console.log("login - referrer:" + req.headers.referer + ' remoteAddress:' + req.connection.remoteAddress); //sic
    if (req.body.username === "" || req.body.password === "") {
        res.redirect("/login?rd=" + encodeURIComponent(req.body.rd) +"&error=" + encodeURIComponent("ERROR: Please enter userID & password"))
    }else{
        var userJSON = userTableJSON.filter(function (row) {
            return row.id === req.body.username;
        });
        if((typeof userJSON[0]) !== "undefined"){
            if (  !passwordHash.isHashed( userJSON[0].pw)   ){
                console.log('password not hashed - referrer:' + req.headers.referer + ' connection:' + req.connection.remoteAddress + " username:" + req.body.username);
                res.redirect("/login?rd=" + encodeURIComponent(req.body.rd) +"&error=" + encodeURIComponent("User identity not setup"))
            }else{
                if (passwordHash.verify(req.body.password, userJSON[0].pw)) {
                    const redirectTo = req.body.rd ? req.body.rd : '/';
                    req.session.authenticated = true;
                    req.session.username = "Admin";

                    res.redirect(redirectTo);
                } else {
                    console.log('Login credentials incorrect - referer:' + req.headers.referer + ' connection:' + req.connection.remoteAddress + " username:" + req.body.username);
                    res.redirect("/login?rd=" + encodeURIComponent(req.body.rd) +"&error=" + encodeURIComponent("Login credentials incorrect"))
                }
            }
        }
        else{
            console.log('username not found - referrer:' + req.headers.referer + ' connection:' + req.connection.remoteAddress + " username:" + req.body.username);
            res.redirect("/login?rd=" + encodeURIComponent(req.body.rd) +"&error=" + encodeURIComponent("User identity not setup"))
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
    var id = req.query.id;
    var searchSt = req.query.searchSt;
    //console.log("jobs:" + id+":");
    res.writeHead(200, {"Content-Type": "application/json"});
    var resJSON = [];
    if (id !== '#'){
        var rowdata = JSON.parse(JSON.stringify(SystemsJSON[id]) );
        //console.log('gv:' + SystemsJSON[id].variables);
        rowdata.id = id;
        resJSON.push(rowdata);
    }else {

        //Create parent row and place entire tree under it
        var rowdata = {};
        rowdata.id = "local";
        rowdata.name = "local";
        rowdata.text = "Dashboard";
        rowdata.type = "dashboard";
        rowdata.parent = '#';
        resJSON.push(rowdata);
        for (var key in SystemsJSON) {
            if (SystemsJSON.hasOwnProperty(key)) {

                //filter by search string
                if (searchSt.length === 0) {
                    resJSON.push(getTreeFormattedRowData(key, false));
                } else {
                    if(isFoundIn(key, searchSt)){
                        var found = resJSON.find(function (row) {
                            return row.id === key;
                        });
                        if (!found) {
                            resJSON.push(getTreeFormattedRowData(key, true));
                        };

                        var parents = SystemsJSON[key].ft.split("/");
                        parents.forEach(function (parent) {
                            if (parent !== "#") {
                                if (SystemsJSON.hasOwnProperty(parent)) {

                                    var found = resJSON.find(function (row) {
                                        return row.id === parent;
                                    });

                                    if (!found) {
                                        resJSON.push(getTreeFormattedRowData(parent, isFoundIn(parent, searchSt)));
                                    }
                                }
                            }
                        })
                    }
                }

                function isFoundIn(key, searchSt) {
                    var filter = false;
                    if (SystemsJSON[key].name.includes(searchSt)) {
                        filter = true
                    }
                    if (SystemsJSON[key].description.includes(searchSt)) {
                        filter = true
                    }
                    if (SystemsJSON[key].hasOwnProperty("script")) {
                        if (SystemsJSON[key].script.includes(searchSt)) {
                            filter = true
                        }
                    }
                    if (SystemsJSON[key].hasOwnProperty("template")) {
                        if (SystemsJSON[key].template.includes(searchSt)) {
                            filter = true
                        }
                    }
                    return filter
                }
                function getTreeFormattedRowData(key, foundInSearchBool) {
                            rowdata = JSON.parse(JSON.stringify(SystemsJSON[key]));
                            rowdata.id = key;
                            rowdata.text = rowdata.name;

                            if (SystemsJSON[key].comType === "system") {
                                rowdata.type = "system"
                            } else {
                                rowdata.type = "job";
                                if (rowdata.hasOwnProperty("enabled")) {
                                    if (rowdata.enabled === 0) {
                                        rowdata.type = "disabled";
                                    } else if (!rowdata.hasOwnProperty("lastBuild")) {
                                        rowdata.type = "needfull"
                                    } else if (rowdata.rerunnable === 1) {
                                        rowdata.type = "rerunnable"
                                    }
                                }
                            }


                            var searchModClass = foundInSearchBool ? " searchFoundModClass" : " searchNotFoundModClass";

                            if (rowdata.comType === "job") {
                                if (rowdata.hasOwnProperty("lastBuild")) {
                                    if (rowdata.lastBuild.pass === 1) {
                                        rowdata.li_attr = {"class": "runningJobCompleteSuccess" + searchModClass};
                                        rowdata.a_attr = {"class": "runningJobCompleteSuccess" + searchModClass}
                                    } else if (rowdata.lastBuild.pass === 0) {
                                        rowdata.li_attr = {"class": "runningJobCompleteFail" + searchModClass};
                                        rowdata.a_attr = {"class": "runningJobCompleteFail" + searchModClass}
                                    }
                                } else {
                                    rowdata.li_attr = {"class": "newJobRow"};
                                    rowdata.a_attr = {"class": searchModClass}
                                }
                                ;
                            } else {
                                rowdata.li_attr = {"class": "newJobRow"};
                                rowdata.a_attr = {"class": searchModClass}
                            }

                            if (rowdata.icon) {
                                rowdata.icon = "/uploads/" + key + "/" + "icon.png"
                            }

                            var pt = rowdata.parent;
                            if (pt === "#") {
                                rowdata.parent = "local";
                            }
                            ;

                            return rowdata;
                        }
            }
        }
    }
    res.end(JSON.stringify(resJSON));
});

var currentPickedLib = '';
router.get("/getLib",function(req,res) {
    const pickedLib = req.query.pickedLib;
    currentPickedLib = pickedLib;
    const id = req.query.id;
    res.writeHead(200, {"Content-Type": "application/json"});
    if (req.query.id === '#'){
        var resJSON = [];
        if (pickedLib !== '#'){
            const libJSON =  JSON.parse(fs.readFileSync(libsPath + pickedLib + "/SystemsJSON.json"));

            //Create parent row and place entire tree under it
            var rowdata = {};
            rowdata.id = "lib";
            rowdata.name = pickedLib;
            rowdata.text = pickedLib;
            rowdata.parent = '#';

            resJSON.push(rowdata);
            for (var key in libJSON) {
                if (libJSON.hasOwnProperty(key)) {
                    rowdata = JSON.parse(JSON.stringify(libJSON[key]) );
                    rowdata.id = key;
                    rowdata.text = rowdata.name;

                    rowdata.type = libJSON[key].type || libJSON[key].comType;
                    if(rowdata.hasOwnProperty("enabled")){
                        if(rowdata.enabled === 0){
                            rowdata.type="disabled";
                        }else if(rowdata.rerunnable === 1){
                            rowdata.type="rerunnable"
                        }
                    }

                    if(rowdata.icon){
                        rowdata.icon = "/library/" + pickedLib + "/uploads/" + key + "/" + "icon.png"
                    }

                    var pt = rowdata.parent;
                    if(pt === "#"){
                        rowdata.parent = "lib";
                    }
                    resJSON.push(rowdata);
                }
            }
        }
        //console.log(pickedLib);
        res.end(JSON.stringify(resJSON))

    }else{

        const libJSON =  JSON.parse(fs.readFileSync(libsPath + pickedLib + "/SystemsJSON.json"));
        var resJSON = [];
        var rowdata = JSON.parse(JSON.stringify(libJSON[id]) );
        //console.log( libJSON[id].rerunnable);
        rowdata.id = id;
        resJSON.push(rowdata);
        res.end(JSON.stringify(resJSON));
    }

});

router.get("/Sys",function(req,res){
    //console.log("url: " + req.url);
    var id = req.query.id;
    //console.log("sys:" + id+":");
    res.writeHead(200, {"Content-Type": "application/json"});
    var resJSON = [];
    if (id !== ''){
        var rowdata = SystemsJSON[id];
        //console.log("rowdata " + rowdata);
        rowdata.id = id;
        resJSON.push(rowdata);
        //console.log("resJSON.id = " + resJSON.id);
        res.end(JSON.stringify(resJSON));
        //console.log(JSON.stringify(resJSON));
    }else{
        res.end("");
    }
});

router.get("/LibSys",function(req,res){
    //console.log("url: " + req.url);
    const pickedLib = req.query.pickedLib;

    const id = req.query.id;

    res.writeHead(200, {"Content-Type": "application/json"});
    var resJSON = [];
    if (id !== ''){
        const libJSON =  JSON.parse(fs.readFileSync(libsPath + pickedLib + "/SystemsJSON.json"));
        var rowdata = libJSON[id];
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
    var tree =reqJSON.tree;

    if(tree === 'working'){
        ids.forEach(function(id) {
            if(SystemsJSON.hasOwnProperty(id)) {
                delete SystemsJSON[id]; //delete from main datastore
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
        saveAllJSON(true);

    }else{
        const libJSON =  JSON.parse(fs.readFileSync(libsPath + tree + "/SystemsJSON.json"));
        const libPath = __dirname + "/library/" + tree;
        ids.forEach(function(id) {
            if((libJSON.hasOwnProperty(id)) && (id.length > 20)) {
                delete libJSON[id]; //delete from main datastore

                rmDir(libPath + '/uploads/' + id); //delete all uploaded files
            }
        });
        fs.writeFile(libPath + '/SystemsJSON.json', JSON.stringify(libJSON), function (err) {
            if (err) {
                console.log('There has been an error saving your library json\n' + err.message);
            }

        });
    }

    res.end('');
});

router.post("/clear",function(req,res){
    //clear all build history foe a system(results files & job.lastBuild)
    var reqJSON= req.body;
    var id =reqJSON.ids.split(';')[0];
    if(SystemsJSON[id].comType !== "system"){
        res.end('error');
    }else{
        // delete results files
        fs.readdir(resultsPath, function(err, files){
            if (err){
                console.log("clear results files failed: " + resultsFilesPath + mFile);
                console.log(err);
            }else{
                files.forEach(function(mFile){

                    var fileId = mFile.substr(0,36);
                    if(SystemsJSON.hasOwnProperty(fileId)) {

                        if( SystemsJSON[fileId].comType === "job"){
                            if(SystemsJSON[fileId].ft.split("/")[1] === id) {

                                if (fs.statSync(resultsPath + mFile).isFile()){
                                    //console.log("removing: " + resultsPath + mFile);
                                    fs.unlinkSync(resultsPath + mFile);
                                }
                            }
                        }
                    }
                })
            }

        });

        // delete SystemsJSON[key].lastBuild
        if(SystemsJSON.hasOwnProperty(id)) {
            if(SystemsJSON[id].comType === "system"){
                for (var key in SystemsJSON) {
                    if (SystemsJSON.hasOwnProperty(key)) {
                        if( SystemsJSON[key].comType === "job"){
                            if(SystemsJSON[key].ft.split("/")[1] === id){
                                //console.log("del lastBuild: " + SystemsJSON[key].name)
                                delete SystemsJSON[key].lastBuild;
                            }
                        }
                    }
                };
                saveAllJSON(true);
            }
        }
        res.end('Completed');
    }

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
    var id = req.query.id;
    var direction = req.query.direction[0];

    console.log(id+":"+direction);

    if(id === '' || direction === ''){
        res.end('');
    }

    var parent = SystemsJSON[id].parent;
    // var sysAr = [];

    var x =0;
    var beforeId = '';
    var posId = ''
    var afterId = '';
    var lastId ='';
    // var pos = 0;
    for (var key in SystemsJSON) {
        if (parent === SystemsJSON[key].parent) {
            //console.log("found: " , SystemsJSON[key].name,  SystemsJSON[key].sort, parent , SystemsJSON[key].parent);
            if (afterId === '') {
                if (beforeId !== '') {
                    afterId = key;
                }
                if (key === id) {
                    beforeId = lastId;

                    posId = key;
                }
                lastId = key;
            }
            SystemsJSON[key].sort = x;
            x++;
        }
    }

    var newPos = SystemsJSON[posId].sort;
    if(direction === 'u' && beforeId !== ''){
        //console.log('direction:' + direction, beforeId, SystemsJSON[beforeId].sort);
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
    });

    var SystemsJson_sorted = {};
    for (var i=0; i < SystemsArr_sorted.length; i++){
        SystemsJson_sorted[SystemsArr_sorted[i][0]] = SystemsArr_sorted[i][1];
    }

    SystemsJSON = SystemsJson_sorted;

    saveAllJSON(true);

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
    var id = req.query.id;
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
    //console.log("comType: "+req.body.comType);
    if(req.body.comType !== "system"){
        var comType = "job";
        if (id.length < 32){ //new
            var pid = req.body.parent;
            var parentFamTree = SystemsJSON[pid].ft;
            var x =0;
            for (var key in SystemsJSON) {
                if (SystemsJSON[key].parent === pid) {
                    x++;
                }
            }

            //initial history json
            var ds = new Date().toISOString();
            var hist=[{username:config.username, ds: ds, fromId: ""}];

            id = generateUUID();
            foundRow = {parent:pid, ft:parentFamTree+'/'+pid, name:req.body.name, ver:1, enabled:1, promoted:0, rerunnable:0, systemFunction:0,  runLocal:0, comType: 'job', description: req.body.description, script:req.body.script, variables:req.body.compVariables, template:req.body.template, text:req.body.name, resourceFiles:[], sort:x, hist:hist};
            SystemsJSON[id] = foundRow;
        }else{
                //not new
                var newData = {};
                newData.parent = SystemsJSON[id].parent;;
                newData.ft = SystemsJSON[id].ft;
                newData.name = req.body.name;
                newData.enabled = req.body.enabled;
                newData.rerunnable = req.body.rerunnable;
                newData.promoted = req.body.promoted;
                newData.systemFunction = req.body.systemFunction;
                newData.runLocal = req.body.runLocal;


            if(SystemsJSON[id].hasOwnProperty("lastBuild") ){
                    newData.lastBuild = SystemsJSON[id].lastBuild
                }
                newData.comType = 'job';
                newData.description = req.body.description;
                newData.variables = req.body.compVariables;
                newData.script = req.body.script;
                newData.template = req.body.template;
                newData.text = req.body.name;
                newData.custTemplates = req.body.custTemplates;

                if(req.body.resourceFiles === "[object Object]"){   ////bugged data
                    newData.resourceFiles = "[]";
                }else{
                    newData.resourceFiles = req.body.resourceFiles;
                }


                newData.sort = SystemsJSON[id].sort;

                //add history json to SystemsJSON if not there
                if(!SystemsJSON[id].hasOwnProperty("hist")){
                    SystemsJSON[id].hist = [];
                }
                //append history json
                var ds = new Date().toISOString();
                var currentHist = SystemsJSON[id].hist;
                currentHist.push({username:config.username, ds: ds, fromId: ""});
                newData.hist=currentHist;

            if ( SystemsJSON[id].hasOwnProperty('ver') ) {
                newData.ver = SystemsJSON[id].ver + 1;
            }else{
                newData.ver = 1;
            }

                SystemsJSON[id] = newData;
                foundRow = SystemsJSON[id];
               //console.log('v:' + req.body.compVariables)
        }
    }else{
        var comType = "system";
        if (id.length < 32){ //new
            var pid = '#';
            var x =0;
            for (var key in SystemsJSON) {
                if (SystemsJSON[key].parent === pid) {
                    x++;
                }
            }
            id = generateUUID();

            //initial history json
            var ds = new Date().toISOString();
            var hist=[{username:config.username, ds: ds, fromId: ''}];

            foundRow = {parent:pid, ft:pid, name:req.body.name, ver:1, comType: "system", description: req.body.description, text:req.body.name, variables:req.body.variables, sort:x, hist:hist};
            SystemsJSON[id] = foundRow;
        }else{ //not new
            var newData = {};
            newData.parent = SystemsJSON[id].parent;
            //newData.ft = SystemsJSON[id].ft;
            newData.ft = "#"
            newData.comType =  "system";
            newData.description = req.body.description;
            newData.text = req.body.name;
            newData.name = req.body.name;
            newData.variables = req.body.variables;
            newData.sort = SystemsJSON[id].sort;
            newData.icon = SystemsJSON[id].icon;

            //add history json to SystemsJSON if not there
            if(!SystemsJSON[id].hasOwnProperty("hist")){
                SystemsJSON[id].hist = [];
            }
            //append history json
            var ds = new Date().toISOString();
            const currentHist = SystemsJSON[id].hist;
            currentHist.push({username:config.username, ds: ds, fromId: ""});
            newData.hist=currentHist;

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
            foundRow.icon = "icon.png";

            SystemsJSON[id].icon = "icon.png";

            //console.log(iconPath);
            if (!fs.existsSync(filesPath + id)) {
                fs.mkdirSync(filesPath + id)
            }
            fs.writeFileSync(iconPath, base64Data, 'base64');
        }
    }

    //console.log("icon: "+SystemsJSON[id].icon);

    saveAllJSON(true);
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
    var reqJSON= req.body;

    var fromIds =reqJSON.ids.split(';');
    var targetId = reqJSON.parent;
    var lib = reqJSON.lib;

    if(lib === 'local'){
        var error = false;
        var errorID = '';
        if ((!SystemsJSON.hasOwnProperty(targetId)) && (targetId !== '#')){
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
            idMap[SystemsJSON[fromIds[0]].parent] = targetId;

            //give new sort to 1st node
            var x =0;
            for (var key in SystemsJSON) {
                if (SystemsJSON[key].parent === targetId) {
                    x++;
                }
            }

            //var resultRows = {};
            fromIds.forEach(function(fromId) {
                var fromNode = SystemsJSON[fromId];
                var id = generateUUID();

                idMap[fromId] = id;
                var newParentId = idMap[SystemsJSON[fromId].parent]
                //console.log('move to:'+SystemsJSON[newParentId].name);

                //initial history json
                var ds = new Date().toISOString();
                var hist=[{username:config.username, ds: ds, fromId: fromId}];


                var NewRow = {
                    parent: newParentId,
                    name: fromNode.name,
                    description: fromNode.description,
                    ver: 1,
                    comType: fromNode.comType,
                    sort:fromNode.sort,
                    text: fromNode.name,
                    hist: hist
                };

                if(newParentId === "#"){
                    NewRow.ft = "#"
                }else{
                    NewRow.ft = SystemsJSON[newParentId].ft + '/' + newParentId;
                }

                if(fromNode.comType === 'job' ){
                    NewRow.enabled=fromNode.enabled;
                    NewRow.rerunnable=fromNode.rerunnable;
                    NewRow.promoted=fromNode.promoted;
                    NewRow.systemFunction=fromNode.systemFunction;
                    NewRow.runLocal=fromNode.runLocal;
                    NewRow.script=fromNode.script;
                    NewRow.variables=fromNode.variables;
                    NewRow.template=fromNode.template;
                    NewRow.custTemplates=fromNode.custTemplates;
                    NewRow.resourceFiles=fromNode.resourceFiles;
                    NewRow.icon=fromNode.icon;
                // }else{
                //     NewRow.icon=fromNode.icon.replace(fromId, id);
                }

                SystemsJSON[id] = NewRow;

                if ( fs.existsSync( filesPath + fromId ) ) { //copy file resources if they exist
                    fs.mkdirSync(filesPath + id);
                    const files = fs.readdirSync(filesPath + fromId);
                    files.forEach(function (file) {
                        if (!fs.lstatSync(filesPath + fromId + '/' + file).isDirectory()) {
                            const targetFile = filesPath + id + '/' + file;
                            const source = filesPath + fromId + '/' + file;
                            fs.writeFileSync(targetFile, fs.readFileSync(source))
                        }
                    })
                }
            });

            SystemsJSON[idMap[fromIds[0]]].sort = x;

            saveAllJSON(true);

            res.sendStatus(200);
            res.end('');
            //console.log("saving script"+ JSON.stringify(foundRow));

        }else{
            res.sendStatus(500);
            res.end("Error:System ID not found - " + errorID)
        }
    }else{
        //console.log(reqJSON);

        var error = false;
        var errorID = '';

        if ((!SystemsJSON.hasOwnProperty(targetId)) && (targetId !== '#')){
            error = true;
            errorID = targetId;
            console.log("Target ID not found in SystemsJSON: " + errorID);
        }

        libJSON = JSON.parse(fs.readFileSync("library/" + lib + "/SystemsJSON.json"));
        fromIds.forEach(function(id){
            if (!libJSON.hasOwnProperty(id) && error === false ){
                error = true;
                errorID = id;
                console.log("From ID not found in lib: " + errorID);
            }
        });

        if(error === false){
            var idMap = {};
            idMap[libJSON[fromIds[0]].parent] = targetId;

            //give new sort to 1st node
            var x =0;
            for (var key in libJSON) {
                if (libJSON[key].parent === targetId) {
                    x++;
                }
            }

            fromIds.forEach(function(fromId) {
                var fromNode = libJSON[fromId];
                var id = generateUUID();

                idMap[fromId] = id;
                var newParentId = idMap[libJSON[fromId].parent];

                // var newIcon = '';
                // if(fromNode.hasOwnProperty('icon')){
                //     var newIcon = fromNode.icon;
                // }

                //initial history json
                const ds = new Date().toISOString();
                const hist=[{username:config.username, ds: ds, fromId: fromId}];

                var NewRow = {
                    parent: newParentId,
                    name: fromNode.name,
                    description: fromNode.description,
                    ver: 1,
                    comType: fromNode.comType,
                    variables: fromNode.variables,
                    sort:fromNode.sort,
                    text: fromNode.name,
                    lib: lib,
                    hist: hist,
                    icon: fromNode.icon
                };

                if(newParentId === "#"){
                    NewRow.ft = "#"
                }else{
                    NewRow.ft = SystemsJSON[newParentId].ft + '/' + newParentId;
                }

                if(fromNode.comType === 'job'){
                    NewRow.ft = SystemsJSON[newParentId].ft + '/' + newParentId;
                    NewRow.enabled=fromNode.enabled;
                    NewRow.rerunnable=fromNode.rerunnable;
                    NewRow.promoted=fromNode.promoted;
                    NewRow.systemFunction=fromNode.systemFunction;
                    NewRow.runLocal=fromNode.runLocal;
                    NewRow.script=fromNode.script;
                    NewRow.template=fromNode.template;
                    NewRow.custTemplates=fromNode.custTemplates;
                    NewRow.resourceFiles=fromNode.resourceFiles;
                    NewRow.icon=fromNode.icon;
                // }else{
                //     NewRow.icon=fromNode.icon;
                }

                SystemsJSON[id] = NewRow;

                const libPath = libsPath + lib + "/";

                //console.log("libPath:" + libPath );
                if ( fs.existsSync( libPath + "/uploads/" + fromId ) ) { //copy file resources if they exist

                    fs.mkdirSync(filesPath + id);
                    const files = fs.readdirSync(libPath + "/uploads/" + fromId +  "/");
                    files.forEach(function (file) {
                        if (!fs.lstatSync(libPath + "/uploads/" + fromId + '/' + file).isDirectory()) {
                            const targetFile = filesPath + id +"/"+ file;
                            const source = libPath + "/uploads/" + fromId + '/' + file;
                            //console.log("targetFile:" + targetFile);
                            //console.log("source:" + source);
                            fs.writeFileSync(targetFile, fs.readFileSync(source))
                        }
                    })
                }
            });

            SystemsJSON[idMap[fromIds[0]]].sort = x;

            saveAllJSON(true);

            res.sendStatus(200);
            res.end('');
            //console.log("saving script"+ JSON.stringify(foundRow));

        }else{
            res.sendStatus(500);
            res.end("Error:System ID not found - " + errorID)
        }
    }

});

router.post("/copyToLib",function(req,res){
    var reqJSON= req.body;

    var fromIds =reqJSON.ids.split(';').filter(Boolean);
    var targetId = reqJSON.parent;
    var lib = reqJSON.lib;

   // console.log(targetId);
    if(targetId === 'lib'){
        targetId = '#'
    }

    libJSON = JSON.parse(fs.readFileSync("library/" + lib + "/SystemsJSON.json"));

    var error = false;
    var errorID = '';
    if ((!libJSON.hasOwnProperty(targetId)) && (targetId !== '#')){
        error = true;
        errorID = targetId;
        res.sendStatus(500);
        console.log("Error:Target ID not found in library system json - " + errorID);
        res.end("")
    }
    fromIds.forEach(function(id){

        if (!SystemsJSON.hasOwnProperty(id) && error === false ){
            error = true;
            errorID = id;
            res.sendStatus(500);
            console.log("Error:Source ID not found in system json - " + errorID);
            res.end("")
        }
    });

    if(error === false){
        var idMap = {};
        idMap[SystemsJSON[fromIds[0]].parent] = targetId;

        //find out how many nodes in this branch to use for sort placement
        var x =0;
        for (var key in libJSON) {
            if (libJSON[key].parent === targetId) {
                x++;
            }
        }

        const libPath = __dirname + "/library/" + lib;

        fromIds.forEach(function(fromId) {
            var fromNode = SystemsJSON[fromId];
            var id = generateUUID();

            idMap[fromId] = id;
            var newParentId = idMap[SystemsJSON[fromId].parent];

            //console.log('copy to:'+libJSON[newParentId].name);

            //console.log('copy from:'+fromNode.name);

            // var newIcon = '';
            // if(fromNode.hasOwnProperty('icon')){
            //     console.log("fromNode.icon: "+fromNode.icon);
            //     var newIcon = "/library/" + lib + fromNode.icon.replace(fromId, id);
            // }

            var NewRow = {
                parent: newParentId,
                name: fromNode.name,
                comType: fromNode.comType,
                description: fromNode.description,
                ver: fromNode.ver,
                variables: fromNode.variables,
                sort: fromNode.sort,
                hist: fromNode.hist,
                icon: fromNode.icon
            };
            // if (newIcon !== ''){
            //     NewRow.icon = newIcon
            // }
            //console.log(fromNode.icon);

            if(newParentId === "#"){
                NewRow.ft = "#"
            }else{
                NewRow.ft = libJSON[newParentId].ft + '/' + newParentId;
            }

            const nodeType = fromNode.comType;
            if (nodeType === 'job' ){
                NewRow.script=fromNode.script;
                NewRow.template=fromNode.template;
                NewRow.custTemplates=fromNode.custTemplates;
                NewRow.resourceFiles=fromNode.resourceFiles;
                NewRow.rerunnable=fromNode.rerunnable;
                NewRow.promoted=fromNode.promoted;
                NewRow.systemFunction=fromNode.systemFunction;
                NewRow.runLocal=fromNode.runLocal;
                NewRow.enabled=fromNode.enabled;
            }

            libJSON[id] = NewRow;

            if ( fs.existsSync( filesPath + fromId ) ) { //copy file resources if they exist
                fs.mkdirSync(libPath + '/uploads/' + id);
                const files = fs.readdirSync(filesPath + fromId);
                files.forEach(function (file) {
                    if (!fs.lstatSync(filesPath + fromId + '/' + file).isDirectory()) {
                        const targetFile = libPath + '/uploads/' + id + '/' + file;
                        const source = filesPath + fromId + '/' + file;
                        fs.writeFileSync(targetFile, fs.readFileSync(source))
                    }
                })
            }
        });

        libJSON[idMap[fromIds[0]]].sort = x;

        fs.writeFile(libPath + '/SystemsJSON.json', JSON.stringify(libJSON), function (err) {
            if (err) {
                console.log('There has been an error saving your library json');
                console.log(err.message);
            }
            //console.log('json saved successfully.')
        });

        res.sendStatus(200);
        res.end('');

    }

});

router.get("/libraryList",function(req,res){
    res.writeHead(200, {"Content-Type": "application/json"});

        var priFiles = fs.readdirSync(libsPath + "/private");
        var pubFiles = fs.readdirSync(libsPath + "/public");
        const respObj = {pri:priFiles, pub:pubFiles};
        res.end(JSON.stringify(respObj));
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
            const vName = pair.split('=')[0];
            if (vName === vari){
                returnVal = pair.split('=')[1];
            }
        });
        return(returnVal)
    }else{
        return('');
    }

}

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
var latestVarCache = {};
router.post("/run",function(req,res){
    //console.log("running");

    var job;
    var jobIndex;
    var ids;
    var storeLocal;
    var runKey="";
    var newKey=false;
    var runAccess="";
    var newAccess=false;

    var conn;

    var remoteIP = req.connection.remoteAddress.toString();
    remoteIP = remoteIP.substring(remoteIP.lastIndexOf(":") + 1);

    var builderIP = getIPAddress();
    function getIPAddress() {
        // var interfaces = require('os').networkInterfaces();
        // for (var devName in interfaces) {
        //     var iface = interfaces[devName];
        //     console.log(JSON.stringify(iface));
        //     for (var i = 0; i < iface.length; i++) {
        //         var alias = iface[i];
        //         if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal)
        //             return alias.address;
        //     }
        // }
        //
        // return '';

    }

    // console.log('builderIP: '+builderIP);
    // console.log('remoteIP: '+remoteIP);
    fs.writeFileSync("sec_group_ips.json",JSON.stringify({'builderIP':builderIP, 'remoteIP':remoteIP}))

    var timeOut = 30000;  //By default - how many ms all connections should wait for the prompt to reappear before connection is terminated
    const timeoutNumber = parseInt(config.timeout);
    //console.log("timeoutNumber: " + timeoutNumber)
    if (timeoutNumber > 0 ){ //If config holds timeout, use it.
        timeOut = timeoutNumber
    }

    var lastTimeout;
    var exportVar = "";

    var form = new formidable.IncomingForm();
    form.parse(req, function(err, fields, files) {
        if(err){
            console.log(err);
            //message(err);
        }else{
            ids = fields.ids.split(';');

            var storeLocal = fields.storeLocal;
            if(files.hasOwnProperty('key')   ){
                var myFiles = files['key'];

                if (myFiles.hasOwnProperty('path')) {
                    runKey = fs.readFileSync(myFiles.path);
                    newKey = true;
                    fs.unlink(myFiles.path,function(err){
                        if(err) console.log('Error: unable to delete uploaded key file')
                    });
                    //console.log('runKey file: ' + runKey);
                }
            }else{
                if(storeLocal === 'yes'){
                    if(fields.hasOwnProperty('localStoredKey')){
                        runKey = fields.localStoredKey;
                        //console.log('runKey local: ' + runKey);
                    }
                }
            }

            var storeLocalAccess = fields.storeLocalAccess;
            if(files.hasOwnProperty('access')   ){
                var myFiles = files['access'];

                if (myFiles.hasOwnProperty('path')) {
                    runAccess = fs.readFileSync(myFiles.path);
                    runAccess = runAccess.toString().split('\n')[1];
                    newAccess = true;
                    fs.unlink(myFiles.path,function(err){
                        if(err) console.log('Error: unable to delete uploaded access file')
                    });
                    //console.log('access file: ' + runAccess);
                }
            }else{
                if(storeLocalAccess === 'yes'){
                    if(fields.hasOwnProperty('localStoredAccess')){
                        runAccess = fields.localStoredAccess;
                        //console.log('access file: ' + runAccess);
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
            res.write("\n");
            res.write("key:"+runKey.toString().split('\n').join('key:') );
            res.write("\n");
        }

        if(runAccess.toString() !== '' ){

            var trimmedAccess = runAccess.toString().split('\n');
            var find = '\r';
            var re = new RegExp(find, 'g');
            trimmedAccess = trimmedAccess.toString().replace(re, '');

            if( newAccess === true){
                res.write("\n");
                res.write("access:"+ trimmedAccess.toString());
                res.write("\n");
            };

            //console.log("trimmedAccess: "+trimmedAccess);
            const accessParaCount = trimmedAccess.toString().split(',').length;
            var accessCode = {};
            if(accessParaCount > 1){
                if(accessParaCount === 2 || accessParaCount === 3){
                    accessCode =  { "accessKeyId": trimmedAccess.toString().split(',')[0], "secretAccessKey": trimmedAccess.toString().split(',')[1] };
                    saveAccessConfig()
                }else if(accessParaCount === 5 || accessParaCount === 6){
                    accessCode =  { "accessKeyId": trimmedAccess.toString().split(',')[2], "secretAccessKey": trimmedAccess.toString().split(',')[3] };
                    saveAccessConfig()
                }else{
                    console.log('Error: Unable to parse provided access file, accessParaCount = ' + accessParaCount.toString());
                    console.log(trimmedAccess.toString());
                }
                //console.log('accessCode: ' + accessCode);
                function saveAccessConfig(){
                    fs.writeFile( homedir + "/accessConfig.json", JSON.stringify(accessCode), function (err) {
                        if (err) {
                            console.log('There has been an error saving your access json: ./accessConfig.json');
                            console.log(err.message);
                            return;
                        }
                    })
                }

            }else{
                console.log('Error: Unable to parse provided access file, accessParaCount = ' + accessParaCount.toString());
            }
        }

        var disabledIds = [];
        ids.forEach(function(id){
            if(SystemsJSON[id].enabled !== 1){
                disabledIds.push(id);
            }else if (disabledIds.indexOf(SystemsJSON[id].parent) !== -1){
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
            res.write("\n");
        }
        var id = ids[0];
        //console.log("running: "+ ids);
        jobIndex = 0;
        if (SystemsJSON.hasOwnProperty(id)){
            job = SystemsJSON[id];
                cacheVarVals(latestResultsFileList,job.ft.split('/')[1]);
                runScript(id, job ,"SSH");
        }else{
            console.log("Error: /run id not found in SystemsJSON: "+ id);
        }
    });

    var resultsArray = [];

    var messQueue = [];
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

    function conTimeout () {
        console.log('SSH2 conn timed out ' + timeOut.toString());
        message("No prompt detected " + timeOut.toString() + " ms");
        flushMessQueue();
        //res.write("message:No prompt detected " + timeOut.toString() + " ms") ;
        conn.end();
     }

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
        }); //include most recent of each id

        return (files);
    }
    latestResultsFileList = getLatestResultsFileList(); //cache the list of results files to make var lookups quicker


    function cacheVarVals(latestResultsFileList, systemId){

        //getSystemVarVal(jobId, vari)

        latestResultsFileList.forEach(function (file) {
            var id = file.substr(0, 36);
            if(typeof SystemsJSON[id] !== "undefined"){
                var resultsSystem = SystemsJSON[id].ft.split('/')[1];
                if (systemId === resultsSystem){
                    try {
                        var results = JSON.parse(fs.readFileSync(resultsPath + file));
                    } catch (e) {
                        console.log(resultsPath + file + " not valid results JSON");
                        return('');
                    }
                    var trimmedResults = '';
                    results.forEach(function (row) {
                        if (row.hasOwnProperty('results')) {
                            if (row.results.substr(0, 4) === 'var:') {
                                var varName = row.results.split(':')[1];

                                trimmedResults = row.results.substr(('var:' + varName + ':').length);
                                if(typeof latestVarCache[id] === 'undefined'){
                                    latestVarCache[id] = {};
                                }
                                //var appendedTResults = typeof latestVarCache[id][varName] === 'undefined'  ?  trimmedResults  : latestVarCache[id][varName] + trimmedResults;
                                latestVarCache[id][varName] = trimmedResults.replace(/\n$/, "").replace(/\r$/, "");

//console.log("found: id:" + id + " varName:" + varName + "=" + JSON.stringify(latestVarCache[id][varName]))
                            }
                        }
                        if (row.hasOwnProperty('x') && row.x !== '') {
                            varName = row.x;
                            trimmedResults = row.results;
                            if(typeof latestVarCache[id] === 'undefined'){
                                latestVarCache[id] = {};
                            }
                            //var appendedTResults = typeof latestVarCache[id][varName] === 'undefined'  ?  trimmedResults  : latestVarCache[id][varName] + trimmedResults;
                            latestVarCache[id][varName] = trimmedResults.replace(/\n$/, "").replace(/\r$/, "");
//console.log("found: id:" + id + " varName:" + varName + "=" + JSON.stringify(latestVarCache[id][varName]))
                        }
                    });
                }
            }
        });

        //cache system vars
        var varListAr = SystemsJSON[systemId].variables.split('\n');
        if(typeof latestVarCache[systemId] === 'undefined'){
            latestVarCache[systemId] = {};
        }
        varListAr.forEach(function(pair){
            var kName = pair.split('=')[0];
            var kVal = pair.split('=')[1];
            latestVarCache[systemId][kName] = kVal
            //console.log("found: id:" + systemId + " varName:" + kName + "=" + JSON.stringify(latestVarCache[systemId][kName]))
        });
    }

    console.log("complete cacheVarVals - " + Object.keys(latestVarCache).length.toString() + " results files" );

    function runScript(jobId, job, runMethod) {
        var script = job.script + "\n";
        var scriptArray = script.split("\n");

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
            var exportCommand = "";


            message('Building:' + job.name);
            message('BuildID:[' +jobId+ ']');


            conn.on('error', function (err) {
                console.log('SSH - Connection Error: ' + err);
                message('SSH - Connection Error: ' + err);
                flushMessQueue();
                res.end("status:Scripts Aborted\n");
            });

            conn.on('end', function () {
                //console.log('SSH - Connection Closed');
                jobIndex++;
                //console.log('conn end, jobIndex: ' + jobIndex + " / " + ids.length);

                if (ids.length > jobIndex) {

                    id = ids[jobIndex];

                    if (SystemsJSON.hasOwnProperty(id)) {
                        //console.log("\nrunning: "+ SystemsJSON[id].name);
                        if (sshSuccess) {
                            var job = SystemsJSON[id];

                                runScript(id, job ,"SSH");

                        } else {
                            // message("Script Aborted\n");
                            // flushMessQueue();
                            res.end("status:Scripts Aborted\n");
                        }
                    } else {
                        console.log("Error: /run id not found in SystemsJSON: " + id);
                    }
                } else {
                    //console.log("all scripts completed")
                    if (sshSuccess) {
                        message("All scripts completed\n");
                        flushMessQueue();
                        res.end("status:All scripts completed\n");  //This line triggers ui to complete style format
                    } else {
                        message("Script Aborted\n");
                        flushMessQueue();
                        res.end("status:Scripts Aborted\n");
                    }
                }
            });

            conn.on('ready', function () {


                var commandIndex = 0;
                var prompt = "[SysStack]";
                var atPrompt = false;
                var aSyncInProgress = 0;
                var deferredExit = false;
                var respBufferAccu = new Buffer([]);
                resultsArray = [];
                conn.shell(function (err, stream) {
                    if (err) throw err;

                    stream.on('close', function (code, signal) {
                        var dsString = new Date().toISOString();

                        //writeCloseResponse(sshSuccess === true ? "CompletionSuccess:true\n" : "CompletionSuccess:false\n", dsString);
                        clearTimeout(lastTimeout);
                        //sshSuccess = true;

                        message("Completed " + job.name);
                        message(sshSuccess === true ? "CompletionSuccess:true\n" : "CompletionSuccess:false\n");
                        flushMessQueue();

                        var fds = dsString.replace(/_/g, '-').replace(/T/, '-').replace(/:/g, '-').replace(/\..+/, '');
                        var fileName = "";

                        if (sshSuccess === true) {
                            SystemsJSON[jobId].lastBuild = {ct:fds,pass:1};
                            fileName =  jobId + '_' + fds + '_p.json';
                        } else {
                            SystemsJSON[jobId].lastBuild = {ct:fds,pass:0};
                            fileName = jobId + '_' + fds + '_f.json';
                        }

                        saveAllJSON(false);

                        fs.writeFile(resultsPath + fileName, JSON.stringify(resultsArray), function (err) {
                            if (err) {
                                console.log('There has been an error saving your json.\n'+err.message);
                            }else{
                                if(typeof latestVarCache[jobId] === 'undefined'){
                                    delete latestVarCache[jobId]
                                }
                                cacheVarVals([fileName],job.ft.split('/')[1]);

                                if(SystemsJSON[jobId].systemFunction === 1){
                                    copyVarsToSystem(jobId, fileName)
                                }

                                conn.end();
                            }

                        });


                        function copyVarsToSystem(id, fileName){
                            if(typeof SystemsJSON[id] !== "undefined"){

                                var resultsSystem = SystemsJSON[id].ft.split('/')[1];

                                //grab system vars
                                var varListAr = SystemsJSON[resultsSystem].variables.split('\n');
                                var systemVars = {};
                                varListAr.forEach(function(pair){
                                    if (pair !== "" && pair.split("=").length > 1){
                                        var kName = pair.split('=')[0];
                                        var kVal = pair.split('=')[1];
                                        systemVars[kName] = kVal
                                    }
                                });

                                 try {
                                     var results = JSON.parse(fs.readFileSync(resultsPath + fileName));
                                 } catch (e) {
                                     console.log("copyVarsToSystem:" + resultsPath + file + " not valid results JSON");
                                     return('');
                                 };

                                 var trimmedResults = '';
                                 results.forEach(function (row) {
                                     if (row.hasOwnProperty('results')) {
                                         if (row.results.substr(0, 4) === 'var:') {
                                             var varName = row.results.split(':')[1];
                                             trimmedResults = row.results.substr(('var:' + varName + ':').length).replace("\n","");
                                             systemVars[varName] = trimmedResults
                                         }
                                     }
                                     if (row.hasOwnProperty('x') && row.x !== '') {
                                         var varName = row.x;
                                         trimmedResults = row.results;
                                         systemVars[varName] = trimmedResults
                                     }
                                 });

                                 var newVariables = "";
                                for (var property in systemVars) {
                                    if (systemVars.hasOwnProperty(property)) {
                                        newVariables += property + "=" + systemVars[property] + "\n";
                                    }
                                }
                                SystemsJSON[resultsSystem].variables = newVariables;
                                saveAllJSON(false)
                            }
                        }

                    });
                    stream.on('data', function (data) {

                        res.write(data.toString());

                        //Accumulate to buffer until the prompt appears
                        respBufferAccu = Buffer.concat([respBufferAccu, data]);

                        var tempVal = respBufferAccu.toString();
                        //console.log('data: ' + tempVal);

                        if( respBufferAccu.toString().split('\n').slice(-1)[0]  === prompt){
                            //console.log(respBufferAccu.toString().split('\n').slice(-1)[0] + '===' + prompt);

                            writeResponse(respBufferAccu);
                            respBufferAccu = new Buffer([]);

                            if (commandIndex < scriptArray.length) {
                                var command = scriptArray[commandIndex];
                                var currentCommand = replaceVar(command, job);
                                processDirectives();
                            }
                            if (commandIndex < scriptArray.length) {
                                var command = scriptArray[commandIndex];
                                var currentCommand = replaceVar(command, job);
                                sendCommand();
                            }
                             if (commandIndex < scriptArray.length){
                                 var command = scriptArray[commandIndex];
                                 var currentCommand = replaceVar(command, job);
                                 processDirectives();
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
                            }
                        };
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

                            //console.log('writeResponse: ' + newdataStr);

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

                                    if (!fs.existsSync(filesPath + jobId + '/' + fileName)) {
                                        console.log("Error saving resource file. File resource not found.");
                                        //foundErr = true;
                                        message('error:Resource not found - ' + filesPath + jobId + '/' + fileName);
                                        stream.close();
                                    } else {
                                        aSyncInProgress++;
                                        sendFile(fileName, remotePath, jobId);
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
                                            message('snap:creating snapshot');
                                            flushMessQueue();
                                            const ss = await Page.captureScreenshot({format: 'png', fromSurface: true});
                                            if (!fs.existsSync(filesPath + jobId)) {
                                                fs.mkdirSync(filesPath + jobId)
                                            }
                                            fs.writeFileSync(filesPath + jobId + '/' + 'screenshot.png', ss.data, 'base64');

                                            message("img:"+jobId + '/' + 'screenshot.png');

                                            aSyncInProgress--;
                                            //console.log('saveTemplate:Sent - screenshot.png' );
                                            message('snap:created: ' + "screenshot.png");
                                            message('url:' + url);
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

                            //console.log("replaceVar " + commandIndex.toString());

                            const items = commandStr.split(new RegExp('<%', 'g'));
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
                                    if (typeof latestVarCache[pid] !== "undefined"){
                                        if (typeof latestVarCache[pid][targetVarName] !== "undefined"){
                                            var val = latestVarCache[pid][targetVarName].replace(/\n$/, "").replace(/\r$/, "")
                                            commandStr = commandStr.replace(repStr, val)
                                        }
                                    }
                                }
                                ; //look in parent for vars

                                if (item.length > 2 && item.length < 32 && item.substr(0, 2) == 'a.') {
                                    var targetVarName = item.substr(2);
                                    var repStr = "<%a." + targetVarName + "%>";
                                    var anArr = job.ft.replace('#/', '').split('/');
                                    anArr.reverse().forEach(function (an) {
                                        if (typeof latestVarCache[an] !== "undefined"){
                                            if (typeof latestVarCache[an][targetVarName] !== "undefined"){
                                                var val = latestVarCache[an][targetVarName];
                                                commandStr = commandStr.replace(repStr, val)
                                            }
                                        }
                                    })//reverse the ancestor list so that closer ancestor values are used first.
                                }
                                ; //look in ancestors for vars

                                if (item.length > 2 && item.length < 32 && item.substr(0, 2) == 's.') {
                                    var targetVarName = item.substr(2);
                                    var ft = job.ft;
                                    var repStr = "<%s." + targetVarName + "%>";
                                    var bestVal;
                                    var relativeScore = 0; //track how close of a relative the job the varwas found in and give pref to closer relatives.
                                    
                                    for (var id in SystemsJSON) { //look in all jobs for var.
                                        if (SystemsJSON.hasOwnProperty(id) && SystemsJSON[id].comType === 'job') {
                                            var resultsSystem = SystemsJSON[id].ft.split('/')[1];
                                            if (resultsSystem === ft.split('/')[1]){ //if same system...
                                                if (typeof latestVarCache[id] !== "undefined"){
                                                    if (typeof latestVarCache[id][targetVarName] !== "undefined"){
                                                        var thisScore = calcRelativeScore(ft, SystemsJSON[id].ft);
                                                        var val = latestVarCache[id][targetVarName];
                                                        if(relativeScore < thisScore){
                                                            relativeScore = thisScore;
                                                            bestVal = val;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    //now look in system for the var
                                    if (typeof latestVarCache[ft.split('/')[1]] !== "undefined"){
                                        if (typeof latestVarCache[ft.split('/')[1]][targetVarName] !== "undefined"){
                                            var val = latestVarCache[ft.split('/')[1]][targetVarName];
                                            var thisScore = 2;
                                            if(relativeScore < thisScore){
                                                relativeScore = thisScore;
                                                bestVal = val;
                                            }
                                        }
                                    };
                                    if (typeof bestVal !== "undefined"){
                                        commandStr = commandStr.replace(repStr, bestVal);
                                    }




                                }
                                ; //look in same system for vars

                                function calcRelativeScore(jobFT, foundFT){
                                    //how many gr/parents does the current running job have in common with the found var job..
                                    debugger;
                                    const jobFTArr = jobFT.split('/');
                                    const foundFTArr = foundFT.split('/');
                                    var x = 0;
                                    var score = 0;
                                    while((typeof jobFTArr[x] !== "undefined")&&(typeof foundFTArr[x] !== "undefined")){
                                       if (jobFTArr[x] === foundFTArr[x]){
                                            score++;
                                        };
                                       x++;
                                    }
                                    return score;
                                }

                                // if (item.length > 37 && item.length < 67 && item.split("-").length == 5 && item.substr(14, 1) == '4' && item.substr(36, 1) == '.') {
                                //     var targetVarName = item.substr(37);
                                //     var id = item.substr(0, 36);
                                //     var repStr = "<%" + id + "." + targetVarName + "%>";
                                //
                                //     latestResultsFileList.forEach(function (file) {
                                //         if (file.substr(0, 36) === id) {
                                //             var val = getVarValFromFile(file, targetVarName);
                                //             commandStr = commandStr.replace(repStr, val);
                                //         }
                                //     });
                                // }
                            });

                            //If there are any <% patterns left in the line then raise error and abort
                            const  remainingItemsCount = commandStr.split(new RegExp('<%', 'g')).length;
                            const  remainingItems = commandStr.split(new RegExp('<%', 'g'));
                            if(remainingItemsCount > 1){
                                var item = remainingItems[1]
                                item = item.substr(0, item.indexOf('%>'));

                                if (item.length > 2 && item.length < 32) {
                                    //console.log("Error: Component Variable not found: " + item + '\n');
                                    message("Error: Component Variable not found: " + item + '\n');
                                    flushMessQueue();
                                    sshSuccess = false;
                                    stream.close();
                                    return ('');
                                }
                            }
                            return (commandStr);
                        }

                        // function getVarValFromFilex(file, targetVarName) {
                        //     try {
                        //         var results = JSON.parse(fs.readFileSync(resultsPath + file));
                        //     } catch (e) {
                        //         console.log(resultsPath + file + " not valid results JSON");
                        //         return('');
                        //     }
                        //     var trimmedResults = '';
                        //     results.forEach(function (row) {
                        //         if (row.hasOwnProperty('results')) {
                        //             if (row.results.substr(0, 4) === 'var:') {
                        //                 var varName = row.results.split(':')[1];
                        //                 if (varName === targetVarName) {
                        //                     trimmedResults += row.results.substr(('var:' + varName + ':').length)
                        //                 }
                        //             }
                        //         }
                        //         if (row.hasOwnProperty('x') && row.x !== '') {
                        //             varName = row.x;
                        //             if (varName === targetVarName) {
                        //                 trimmedResults += row.results
                        //             }
                        //         }
                        //     });
                        //     return (trimmedResults.replace(/\n$/, "").replace(/\r$/, ""));
                        // }   // delete--------------------
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

            //console.log('jobId: ' + jobId);
            //console.log('runKey: ' + runKey);

            try {
                var connectHost;
                if(SystemsJSON[jobId].runLocal === 1){
                    connectHost = "127.0.0.1"
                }else{
                    connectHost = getSystemVarVal(jobId, 'host')
                }
                conn.connect({
                    host: connectHost ,
                    port: getSystemVarVal(jobId, 'port'),
                    username: getSystemVarVal(jobId, 'username'),
                    privateKey: runKey
                });
            }
            catch(error) {
                console.error(error);
                console.log('runKey: ' + runKey);
                res.end("**Connection Error**");
            }

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
                // console.log(file)
                var id = file.split('_')[0];
                // console.log(id)
                if(SystemsJSON.hasOwnProperty(id)){
                    var name = SystemsJSON[id].name;
                    var ftRaw = SystemsJSON[id].ft;
                    var ftAr = ftRaw.split('/');
                    var t = [];
                    ftAr.forEach(function(id){
                        if (id !== '#'){
                            if((typeof SystemsJSON[id]) === "undefined"){
                                // console.log(JSON.stringify(SystemsJSON[id]),id, ftRaw, name)
                            }
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

router.get(["/uploads/*", "/library/*"],function(req,res){

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

router.get("/getStyle",function(req,res){
    var styleName = req.query.styleName;

    if(!config.hasOwnProperty('currentStyle')){
        saveSettings("currentStyle", 'default')
    }

    if (styleName === '') {
        styleName = config.currentStyle;
    }

    if (styleName === 'dark') {
        try {
            var cssJson = fs.readFileSync(stylesPath + 'dark.css').toString();

            res.writeHead(200, {"Content-Type": "application/json"});
            const respJson = {css: cssJson};
            saveSettings("currentStyle", 'dark');
            res.end(JSON.stringify(respJson));
        } catch (e) {
            res.writeHead(300, {"Content-Type": "text/plain"});
            res.end('');
            throw e;
        }
    }else{
        try {
            var cssJson = fs.readFileSync(stylesPath + 'default.css').toString();

            res.writeHead(200, {"Content-Type": "application/json"});
            const respJson = {css: cssJson};
            saveSettings("currentStyle", 'default');
            res.end(JSON.stringify(respJson));
        } catch (e) {
            res.writeHead(300, {"Content-Type": "text/plain"});
            res.end('');
            throw e;
        }
    }

});

router.get("/ClosestRerunnableAn",function(req,res){
    var id = req.query.id;

    var ClosestRerunnableAn = {};
    var ClosestRerunnableAnID = "";
    if (SystemsJSON.hasOwnProperty(id) ){
        if(SystemsJSON[id].rerunnable !== 1){
            var parentID = SystemsJSON[id].parent;
            var x = 0;
            while ((parentID !== "#") && (ClosestRerunnableAnID === "") && (x < 100)){

                if (SystemsJSON.hasOwnProperty(parentID) ){
                    if(SystemsJSON[parentID].rerunnable === 1){
                        ClosestRerunnableAn = SystemsJSON[parentID];
                        ClosestRerunnableAnID = parentID
                    }
                }
                parentID = SystemsJSON[parentID].parent;
                x++
            }
        }

    }else{

    }
    res.end(JSON.stringify({id:ClosestRerunnableAnID, ClosestRerunnableAn:ClosestRerunnableAn}));

});

router.post("/setTimeout",function(req,res){

    var reqJSON = req.body;
    var timeout = reqJSON.timeout;
    const timeoutNumber = parseInt(timeout);

    if(timeoutNumber > 0) {
        if( !saveSettings("timeout", timeout) ){
            res.write("Timeout set to " + timeout + " ms")
        }else{
            res.write("Error setting timeout")
        }
    }else{
        res.write("Timeout not set. Must be greater than 0 ms")
    }
    res.end('')
});

router.post("/setUsername",function(req,res){

    var reqJSON = req.body;
    var username = reqJSON.username.trim()
    if(username.length < 8){
        res.write("User Name not set. Must be at least 8 characters.")
    }else{
        if( !saveSettings("username", username)){
            res.write("User Name set to " + username)
        }else{
            res.write("Error setting username")
        }

    }
    res.end('')
});

router.get("/settings",function(req,res){
    res.writeHead(200, {"Content-Type": "application/json"});

    const respObj = config;
    res.end(JSON.stringify(respObj));
});

router.post("/firstRun",function(req,res){

    var reqJSON = req.body;
    var firstRun = reqJSON.firstRun;

    if( !saveSettings("firstRun", 1) ){
        res.write("firstRun set")
    }else{
        res.write("Error setting firstRun")
    }
    res.end('')
});

router.get("/getPromoted",function(req,res){

    var rowdata={};
    var resJSON = [];
    for (var key in SystemsJSON) {
        if (SystemsJSON.hasOwnProperty(key)) {
            if(SystemsJSON[key].promoted === 1){

                var  hostIP = getSystemVarVal(key, "host");

                if(hostIP !=="" || SystemsJSON[key].runLocal === 1){
                    rowdata = JSON.parse(JSON.stringify(SystemsJSON[key]) );
                    rowdata.id = key;
                    rowdata.systemName =  SystemsJSON[rowdata.ft.split("/")[1]].name;
                    rowdata.systemId =  rowdata.ft.split("/")[1];

                    resJSON.push(rowdata);
                }
            }
        }
    };

    //resJSONSorted = resJSON.sort();
    resJSON.sort(function(a, b){
        var sortTxta = " ";
        var sortTxtb = " ";
        a.ft.split('/').forEach(function(row){
            sortTxta += row.length>20 ? "?" + SystemsJSON[row].sort.toString() : "";
        });
        b.ft.split('/').forEach(function(row){
            sortTxtb += row.length>20 ? "?" + SystemsJSON[row].sort.toString() : "";
        });

        var keyA = sortTxta + (a.sort.toString()),
            keyB = sortTxtb + (b.sort.toString());

        if(keyA < keyB) return -1;
        if(keyA > keyB) return 1;
        return 0;
    });

    // for (var key in resJSON) {
    //     var sortTxta = " ";
    //     resJSON[key].ft.split('/').forEach(function(row){
    //         sortTxta += row.length>20 ? "?" + SystemsJSON[row].sort.toString() : "";
    //     });
    //
    //     console.log(resJSON[key].name + " " + sortTxta)
    //
    // }

    res.end(JSON.stringify(resJSON));
});

router.get("/getCPUStats",function(req,res){

    function buildCPUStats() {
        var result = {last10:null, last50:null, last100:null, freeMem:null};
        var percent = 0;
        var i = samples.length;
        var j = 0;
        while (i--) {
            j++;
            if (samples[i].total > 0)
                percent += (100 - Math.round(100 * samples[i].idle / samples[i].total));
            if (j === 10)       result.last10  = percent/j;
            else if (j === 50)  result.last50  = percent/j;
            else if (j === 100) result.last100 = percent/j
        }
        result.freeMem = os.freemem();
        return(result)
    };


    res.end(JSON.stringify(buildCPUStats()));

});
var samples = [];
var prevCpus = os.cpus();
setInterval(sample,1000); //run every 1000 ms
function sample() {
    currCpus = os.cpus();
    for (var i=0,len=currCpus.length;i<len;i++) {
        var prevCpu = prevCpus[i];
        var currCpu = currCpus[i];
        var deltas = {total:0};
        for (var t in prevCpu.times)
            deltas.total += currCpu.times[t] - prevCpu.times[t]
        for (var t in prevCpu.times)
            deltas[t] = currCpu.times[t] - prevCpu.times[t]
    }
    prevCpus = currCpus;
    samples.push(deltas);
    if (samples.length>100) samples.shift()
}


function saveAllJSON(backup){
    //console.log("saving");
    fs.writeFile('SystemsJSON.json', JSON.stringify(SystemsJSON), function (err) {
        if (err) {
            console.log('There has been an error saving your json.');
            console.log(err.message);
            return;
        }else if(backup){
            console.log("backup");
            var dsString = new Date().toISOString();
            var fds = dsString.replace(/_/g, '-').replace(/T/, '-').replace(/:/g, '-').replace(/\..+/, '');
            const fname = 'SystemsJSON_'+fds+'.json';
            fs.writeFile(__dirname + "/backup/" + fname, JSON.stringify(SystemsJSON), function (err) {
                if (err) {
                    console.log('There has been an error saving your json: /backup/'+fname);
                    console.log(err.message);
                    return;
                }else{
                    var x = 1;
                    fs.readdir(__dirname + "/backup/", function(err, files){ // delete older backups files
                        if (err){
                            console.log("Error reading " + __dirname + "/backup/ dir\n" + err);
                        }else{
                            files.forEach(function(mFile){
                                if (fs.statSync(__dirname + "/backup/" + mFile).isFile()){
                                    if((x + 20) <  files.length){
                                        //console.log("removing"  + __dirname + "/backup/" + mFile );
                                        fs.unlinkSync(__dirname + "/backup/" + mFile)
                                    };
                                    x++
                                }
                            })
                        }

                    });
                }
            })
        }
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

function saveSettings(name, value){
    config[name] = value;

    fs.writeFile('config.json', JSON.stringify(config), function (err) {
        if (err) {
            console.log('There has been an error saving your config.json.');
            console.log(err.message);
            return false;
        }else{
            return true;
        }

    });
}

app.use("/",router);

app.use("*",function(req,res){
    res.status(404).end("404")
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


