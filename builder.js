/*
 builder.js
 Usage: node builder
 Complete back-end code for ezStack Builder Prototype. Ensure SystemsJSON.json (at least "{}") exists in the builder folder.
*/
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
const os = require('os');

const router = express.Router();
const viewPath = __dirname + '/views/';
const resultsPath = __dirname + '/results/';
const filesPath = __dirname + '/uploads/';
const libsPath = __dirname + '/library/';
const treeStylesPath = __dirname + '/static/jstree/dist/themes/';
const staticPath = __dirname + '/static/';
const stylesPath = __dirname + '/static/theme/';

//Load configs into global config obj
const cf = fs.readFileSync('config.json');
const config = JSON.parse(cf);

//Enable express-session
app.use(session({
        store: new FileStore, // ./sessions
        secret: config.session_secret,
        resave: true,
        saveUninitialized: true,
        name:config.session_name
    }));

//Enable static assets in the ./static folder
app.use(express.static('static'));

// all templates are located in `/views` directory
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

//Captur location of the current uses home folder
const homedir = require('os').homedir();

//Define required globals
const SystemsJSONContents = fs.readFileSync('SystemsJSON.json');
global.SystemsJSON = JSON.parse(SystemsJSONContents);

global.Page = '';
global.protocol='';
global.chrome='';

//Launch headless Chrome async
(async function () {
    async function launchChrome() {
        return await chromeLauncher.launch({
            chromeFlags: ["--disable-gpu", "--headless",  "--no-sandbox"] //"--enable-logging", , '--window-size=800,600', --force-device-scale-factor=1.5
        });
    }
    chrome = await launchChrome();
    console.log('Chrome debugging port running on ' + chrome.port);

    const viewport = [1280,720];

    protocol = await CDP({
        port: chrome.port
    });

    Page = protocol.Page;
    const {DOM, Emulation, Runtime} = protocol;
    await Promise.all([Page.enable(), Runtime.enable(), DOM.enable()]);

    var device = {
        width: viewport[0],
        height: viewport[1],
        deviceScaleFactor: 1.0,
        mobile: false,
        fitWindow: true
    };

    // set viewport and visible size
    await Emulation.setDeviceMetricsOverride(device);
    await Emulation.setVisibleSize({width: viewport[0], height:viewport[1]});

    await Page.navigate({url: 'http://google.com'});
    await Page.loadEventFired();


    Page.screencastFrame(image => {

        frameCount++;
        const {data, metadata, sessionId} = image;
        image.frameCount = frameCount;
        currentFrame = image;

        console.log('saved frame ' + frameCount.toString());

        // lastShot = setTimeout(ackFrame, 1000);
        // lastFrameId = sessionId;
        // function ackFrame(){
            Page.screencastFrameAck({sessionId: sessionId});
        // }
    });

})();
// var lastFrameId = "";

//Define user table global
var userTable = fs.readFileSync("./identity/identity.json");
var userTableJSON = JSON.parse(userTable);

//Use bodyParser in various router.post to assist in parcing req data
app.use(bodyParser.json({limit: '10mb'}));
app.use(bodyParser.urlencoded({limit: '10mb', extended: true}));

//Log all reqs in accesslog.txt
router.use(function (req,res,next) {
   var log = {
        date: new Date().toISOString().replace(/T/, '_').replace(/:/g, '-'),
        md: req.method,
        protocol: req.protocol,
        host: req.get('host'),
        pathname: req.originalUrl,
        rad: req.connection.remoteAddress
    };
    fs.appendFile('accesslog.txt', log, function (err) {
        if (err) throw err;
        //console.log('Saved!');
    });

    //Reset no client timeout
    clearTimeout(lastnoClientTimeout);
    resetlastnoClientTimeout();

    next();
});



var lastnoClientTimeout;
var noClientTimeout = config.hasOwnProperty("noClientTimeout") ? config.noClientTimeout : "15";
function resetlastnoClientTimeout(){
    //lookup user pref noClientTimeout value
    noClientTimeout = config.hasOwnProperty("noClientTimeout") ? config.noClientTimeout : "15";
    var noClientTimeoutNumber = parseInt(noClientTimeout) * 1000 * 60; //Convert minutes to ms
    lastnoClientTimeout = setTimeout(noClientTimeoutProcess, noClientTimeoutNumber);
}
resetlastnoClientTimeout();
function noClientTimeoutProcess(){
    console.log("No client request within timeout: " + noClientTimeout + " minutes. Shutting server down..." );
    execSync('sudo shutdown now');
};

//Reqs to / endpoint are ignored for now
router.get("/",function(req,res){
    res.end('')
});

//Service Rt: /login, Method: get, Requires: Nothing, Returns: render(login)
router.get("/login",function(req,res){
    //console.log("error: " + req.query.error);
    //console.log("rd: " + req.query.rd);
    res.render('login', {error: req.query.error});
});

//Service Rt: /login, Method: post, Requires: rd=[redirect uri], Returns: redirect(rd)
router.post("/login",function(req,res) {

    console.log("login - referrer:" + req.headers.referer + ' remoteAddress:' + req.connection.remoteAddress); //sic
    //if name and pw are empty, set errpr and redirect
    if (req.body.username === "" || req.body.password === "") {
        res.redirect("/login?rd=" + encodeURIComponent(req.body.rd) +"&error=" + encodeURIComponent("ERROR: Please enter userID & password"))
    //else find user in user table and validate
    }else{
        var userJSON = userTableJSON.filter(function (row) {
            return row.id === req.body.username;
        });
        if((typeof userJSON[0]) !== "undefined"){//Varify username is in user table
            if (  !passwordHash.isHashed( userJSON[0].pw)   ){ //Check if supplied pw is hashed and log error if not hashed
                console.log('password not hashed - referrer:' + req.headers.referer + ' connection:' + req.connection.remoteAddress + " username:" + req.body.username);
                res.redirect("/login?rd=" + encodeURIComponent(req.body.rd) +"&error=" + encodeURIComponent("User identity not setup"))
            }else{
                if (passwordHash.verify(req.body.password, userJSON[0].pw)) { //Verify PW and redirect to para rd if correct
                    const redirectTo = req.body.rd ? req.body.rd : '/';
                    req.session.authenticated = true;
                    req.session.username = "Admin";

                    res.redirect(redirectTo);
                } else { //log in incorrect. Redirect back to /login
                    console.log('Login credentials incorrect - referer:' + req.headers.referer + ' connection:' + req.connection.remoteAddress + " username:" + req.body.username);
                    res.redirect("/login?rd=" + encodeURIComponent(req.body.rd) +"&error=" + encodeURIComponent("Login credentials incorrect"))
                }
            }
        }
        else{ // username is not in user table. Log error and redirect to login
            console.log('username not found - referrer:' + req.headers.referer + ' connection:' + req.connection.remoteAddress + " username:" + req.body.username);
            res.redirect("/login?rd=" + encodeURIComponent(req.body.rd) +"&error=" + encodeURIComponent("User identity not setup"))
        }

    }

});

router.get('/video', function(req, res) {

    startDate = new Date();
    totalStartDate = new Date();
    frameCount = 0;
    console.log("/video started");

    res.writeHead(200, {
        'Connection': 'keep-alive',
        // 'Content-Type': 'text/event-stream; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Content-Type': 'image/png;base64',
        'Content-Transfer-Encoding': 'BASE64'
    });

    Page.startScreencast({
        format: 'png',
        everyNthFrame: 10
    });

    const myInt = setInterval(sendBlock,1500);
    var sendCount = 0;
    function sendBlock(){
        var endDate = new Date();
        var totalSeconds = (endDate - totalStartDate) / 1000;
        sendCount++;

        if(sendCount > 30){
            clearInterval(myInt);
            //console.log('stopping ' + frameCount.toString());
            Page.stopScreencast();
            frameCount = 0;
            res.end();
            totalStartDate = new Date();
            console.log('stopped ' + totalSeconds.toString() + " seconds" );
        }else{
            //only send if frame has changed
            if(currentFrame.data !== lastFrame.data){
                res.write(JSON.stringify(currentFrame)+'<-->');
                lastFrame = currentFrame;
                console.log('sent: ' + frameCount.toString());
            }else{
                console.log('skip: ' + frameCount.toString());
            }
        }
    }

});


var lastFrame = {};
var currentFrame = {};
var startDate = new Date();
var totalStartDate = new Date();
var frameCount = 0;
// -------------------All routes below require authentication-----------------------------------------------------

//Service Rt: /* [All], Method: get, Requires: none, Returns:  if auth then next() else redirect(rd)
router.get("/*",function(req,res,next) {
    var sess = req.session; //Check if authenticated
    if (!sess.authenticated) {
        //console.log("/login?rd=" + encodeURIComponent(req.url));
        res.redirect("/login?rd=" + encodeURIComponent(req.url));
    }else{
        next();
    }
});

//Service Rt: /logout, Method: get, Requires: none, Returns: cleared session then redirect(/)
router.get('/logout', function (req, res) {
    delete req.session.authenticated;
    delete req.session.username;
    res.redirect('/');
});

//Service Rt: /builder, Method: get, Requires: none, Returns:  render(builder)
router.get("/builder",function(req,res){
    var sess = req.session;
    res.render("builder", {username: sess.username});
});

//Service Rt: /jobsTree [components], Method: get, Requires: id = component ID or # [all], Returns: array of one(#) or all components filtered by req.query.searchSt tailored for jsTree api
router.get("/JobsTree",function(req,res){
    //console.log("url: " + req.url);
    var id = req.query.id;
    var searchSt = req.query.searchSt;
    //console.log("jobs:" + id+":");
    res.writeHead(200, {"Content-Type": "application/json"});
    var respTxt = ""
    if (id !== '#'){
        //id is not '#' and is assumed to be a valid SystemsJSON[id]
        //var rowdata = JSON.parse(JSON.stringify(SystemsJSON[id]) );

        //atempting to update single jstree node via refresh_node ...
        //currently not used by ui

        //console.log('gv:' + SystemsJSON[id].variables);
        //rowdata.id = id;
        //resJSON.push(getTreeFormattedRowData(id,""));
        respTxt = JSON.stringify([getTreeFormattedRowData(id,"")])
    }else {
        //id is '#' so return entire tree
        //Create parent row and place entire tree under it
        var resJSON = [];
        var rowdata = {};
        rowdata.id = "local";
        rowdata.name = "local";
        rowdata.text = "Working";
        rowdata.sort = 0;
        rowdata.type = "dashboard";
        rowdata.parent = '#';
        resJSON.push(rowdata);

        //Loop through all SystemJSON and filter if search term is present.
        for (var key in SystemsJSON) {
            if (SystemsJSON.hasOwnProperty(key)) {



                //filter by search string
                if (searchSt.length === 0) { //If no search then simply add row
                    resJSON.push(getTreeFormattedRowData(key, ""));
                } else { //if there is filter spcified, use isFound function to flag rows that match
                    if(isFoundIn(key, searchSt)){ //Component matches

                        var found = resJSON.find(function (row) {
                            return row.id === key;  //Add a prop ID to hold component ID
                        });
                        if (!found) { //Add to return array
                            resJSON.push(getTreeFormattedRowData(key, "foundInSearch"));
                        };

                        //Add all parents as well if they ane not present or change search classes if they are
                        var parents = SystemsJSON[key].ft.split("/");

                        parents.forEach(function (parent) {
                            if (parent !== "#") {
                                if (SystemsJSON.hasOwnProperty(parent)) {

                                    var foundIndex = resJSON.findIndex(x => x.id == parent);

                                    if (foundIndex == -1) {
                                        resJSON.push(getTreeFormattedRowData(parent,""));
                                    }else{
                                        resJSON[foundIndex] = setRowDataClasses(resJSON[foundIndex], "foundInSearchParent");
                                    }
                                }
                            }
                        })
                    }else{

                        var foundIndex = resJSON.findIndex(x => x.id == key);
                        if (foundIndex == -1) {
                            resJSON.push(getTreeFormattedRowData(key, "foundNotInSearch"));
                        }
                    }
                }

                //for mass updates

                // var newArr = {};
                // if(SystemsJSON[key].hasOwnProperty("variables")){
                //     SystemsJSON[key].variables.split("\n").forEach(function (vari) {
                //         if(vari.includes("=")){
                //             var vIndex = vari.split("=")[0];
                //             var varNewVal = vari.split(/=(.+)/)[1];
                //
                //             if(varNewVal){
                //                 newArr[vIndex.trim()] = {"value": varNewVal.trim(),"type":"", "private":false};
                //             }else{
                //                 newArr[vIndex.trim()] = {"value": "","type":"", "private":false};
                //                 console.log(vari)
                //             }
                //         }
                //     });
                //
                //     SystemsJSON[key].variables = newArr;
                // }

            }
        }
       // for mass updates
       //  saveAllJSON(true);

        respTxt = JSON.stringify(resJSON)
    }

    //function isFoundIn: Return flag to indicate if a given component has search term, Requires: key = component ID | searSt = serch term string, Returns: true if found false if not
    function isFoundIn(key, searchSt) {
        //search in  name, Description, variables, script, template
        //Note: not included custom templates in prototype
        var filter = false;
        if (SystemsJSON[key].name.includes(searchSt)) {
            filter = true
        }
        if (SystemsJSON[key].description.hasOwnProperty("ops")){
            SystemsJSON[key].description.ops.forEach(function(row){
                if(row.hasOwnProperty("insert")){
                    if(row.insert.includes(searchSt)) {
                        filter = true
                    }
                }
            })
        }else{
            if(SystemsJSON[key].description.includes(searchSt)) {
                filter = true
            }
        }


        if (SystemsJSON[key].hasOwnProperty("variables")) {

            for(var ind in SystemsJSON[key].variables){
                if (ind.includes(searchSt)) {
                    filter = true
                }
                if (SystemsJSON[key].variables[ind].value.includes(searchSt)) {
                    filter = true
                }
            }
        }
        if (SystemsJSON[key].hasOwnProperty("script")) {
            if (SystemsJSON[key].script.includes(searchSt)) {
                filter = true
            }
        }
        if (SystemsJSON[key].hasOwnProperty("templates")) {
            SystemsJSON[key].templates.tempArr.forEach(function(row){
                // console.log(JSON.stringify(row));
                if(row.hasOwnProperty("c")){
                    if (row.c.includes(searchSt)) {
                        filter = true
                    }
                }
            })

        }
        return filter
    }

    //function getTreeFormattedRowData: Formats the return row json to include li_attr, a_attr for jstree styling, Requires: key = component ID | searchResultsClassToAdd = string name of class to add to indicate search hit, Returns: row data obj
    function getTreeFormattedRowData(key, searchResultsClassToAdd) {

        let rowdata = {};
        rowdata.id = key;
        rowdata.name = SystemsJSON[key].name;
        rowdata.text = SystemsJSON[key].name ;
        //+ (SystemsJSON[key].sort > -1 ? " " + SystemsJSON[key].sort.toString() : "x");
        rowdata.sort = SystemsJSON[key].sort > -1 ? SystemsJSON[key].sort : 0;

        //if type of component = 'system' then add type
        if (SystemsJSON[key].comType === "system") {
            rowdata.type = "system"
        } else { //if non-system add type as 'job'
            rowdata.type = "job";
            if (SystemsJSON[key].hasOwnProperty("enabled")) {
                rowdata.enabled = SystemsJSON[key].enabled;

                if (rowdata.enabled === 0) { //If enabled set type that is used in jstree type plugin
                    rowdata.type = "disabled";
                } else if (!SystemsJSON[key].hasOwnProperty("lastBuild")) {
                    rowdata.type = "needfull"
                } else if (SystemsJSON[key].rerunnable === 1) {
                    rowdata.type = "rerunnable"
                }
            }
        }

        rowdata.comType = SystemsJSON[key].comType;

        rowdata = setRowDataClasses(rowdata, searchResultsClassToAdd);

        if (SystemsJSON[key].icon) {
            rowdata.icon = "/uploads/" + key + "/" + "icon.png"
        }

        var pt = SystemsJSON[key].parent;
        if (pt === "#") {
            rowdata.parent = "local"
        }else{
            rowdata.parent = SystemsJSON[key].parent
        }

        return rowdata;
    }

    function setRowDataClasses(rowdata, searchResultsClassToAdd){
        //Set searchModClass to a class name to set color of jstree row
        var searchModClass = searchResultsClassToAdd;

        if (rowdata.comType === "job") {
            if (SystemsJSON[rowdata.id].hasOwnProperty("lastBuild")) {
                if (SystemsJSON[rowdata.id].lastBuild.pass === 1) {
                    rowdata.li_attr = {"class": "runningJobCompleteSuccess " + searchModClass};
                    rowdata.a_attr = {"class": "runningJobCompleteSuccess " + searchModClass}
                } else if (SystemsJSON[rowdata.id].lastBuild.pass === 0) {
                    rowdata.li_attr = {"class": "runningJobCompleteFail " + searchModClass};
                    rowdata.a_attr = {"class": "runningJobCompleteFail " + searchModClass}
                }
            } else {
                rowdata.li_attr = {"class": "newJobRow"};
                rowdata.a_attr = {"class": searchModClass}
            }

        } else {
            rowdata.li_attr = {"class": "newJobRow"};
            rowdata.a_attr = {"class": searchModClass}
        }
        return rowdata;
    }

    //return new formated json
    res.end(respTxt);
});

//Service Rt: /jobs [components], Method: get, Requires: id = component ID or # [all], Returns:  raw SystemJSON object for ajax queries
router.get("/Jobs",function(req,res){
    var id = req.query.id;
    var searchSt = req.query.searchSt;
    res.writeHead(200, {"Content-Type": "application/json"});
    var resJSON = [];
    if (id !== '#'){
        var rowdata = JSON.parse(JSON.stringify(SystemsJSON[id]) );

        rowdata.id = id;
        resJSON.push(rowdata);
    }
    res.end(JSON.stringify(resJSON));
});

//Global to store the library that the user is currently using
var currentPickedLib = '';
//Service Rt: /getLib, Method: get, Requires: pickedLib file name string | id = '#' for all components or id for one component, Returns:  one or all components in json string array
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

//Service Rt: /Sys, Method: get, Requires: id = id of the system component, Returns:  single system obj if exists
router.get("/Sys",function(req,res){
    var id = req.query.id;
    res.writeHead(200, {"Content-Type": "application/json"});
    var resJSON = [];
    if (id !== ''){
        var rowdata = SystemsJSON[id];
        rowdata.id = id;
        resJSON.push(rowdata);
        res.end(JSON.stringify(resJSON));
    }else{
        res.end("");
    }
});

//Service Rt: /LibSys provide json of a specified system in a library, Method: get, Requires: id = id of the system component | pickedLib = library file name, Returns:  system json if exists
router.get("/LibSys",function(req,res){
    const pickedLib = req.query.pickedLib;

    const id = req.query.id;

    res.writeHead(200, {"Content-Type": "application/json"});
    var resJSON = [];
    if (id !== ''){
        const libJSON =  JSON.parse(fs.readFileSync(libsPath + pickedLib + "/SystemsJSON.json"));
        var rowdata = libJSON[id];
        rowdata.id = id;
        resJSON.push(rowdata);
        res.end(JSON.stringify(resJSON));
    }else{
        res.end("");
    }
});

//Service Rt: /remove deletes specified rows in SystemJSON or Lib and all upload files that are attached, Method: post, Requires: ids = the ids of rows to be removed sepetrated by ';' | tree = working or name of library file name , Returns:  ""
router.post("/remove",function(req,res){
    //remove id from systems json and remove /uploads/ dir
    var reqJSON= req.body;
    var ids =reqJSON.ids.split(';');
    var tree =reqJSON.tree;

    if(tree === 'working'){ //Is the specified tree the working tree?
        ids.forEach(function(id) { //Loop throu all ids
            if(SystemsJSON.hasOwnProperty(id)) {
                delete SystemsJSON[id]; //delete from main datastore
                rmDir(filesPath + id + "/"); //delete all uploaded files
                fs.readdir(resultsPath, function(err, files){ // delete results files
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

    }else{ //Specified tree is a library
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

//Service Rt: /clear all build history for a system(results files & job.lastBuild), Method: post, Requires: id = the id of syem to be cleared , Returns:  "Completed" or "Error"
router.post("/clear",function(req,res){
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

//Function: rmDir(dirPath) recursivly delete specified directory and all children, Requires: dirPath = the folder to be removed , Returns:  nothing
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

//Service Rt: /move up or down the current selected component in sort order, Method: get, Requires: id = the id of component to be moved | direction = 'u' or 'd' , Returns: resorted SystemJSON | json string {newPos:[new sort index]}
router.get("/move",function(req,res){
    //console.log("move...");
    var id = req.query.id;
    var direction = req.query.direction[0]; //either u or d
    var oldPos = SystemsJSON[id].sort;
    var otherId="";

    if(id === '' || direction === ''){
        res.end('');
    }

    var parent = SystemsJSON[id].parent;

    var beforeId = '';
    var afterId = '';

    for (var key in SystemsJSON) {
        if (parent === SystemsJSON[key].parent) {
            //console.log("found: " , SystemsJSON[key].name,  SystemsJSON[key].sort, parent , SystemsJSON[key].parent);

            if (SystemsJSON[id].sort + 1 === SystemsJSON[key].sort ){
                afterId = key
            }
            if (SystemsJSON[id].sort - 1 === SystemsJSON[key].sort ){
                beforeId = key
            }
        }
    }

    //set new sort para for current and before if up
    //var newPos = SystemsJSON[posId].sort;
    if(direction === 'u' && beforeId !== ''){
        var tmp = SystemsJSON[beforeId].sort;
        SystemsJSON[beforeId].sort = SystemsJSON[id].sort;
        SystemsJSON[id].sort = tmp;
        otherId = beforeId;
    }

    //set new sort para for current and after if down
    if(direction === 'd' && afterId !== ''){
        var tmp = SystemsJSON[afterId].sort;
        SystemsJSON[afterId].sort = SystemsJSON[id].sort;
        SystemsJSON[id].sort = tmp;
        otherId = afterId;
    }

    //Save the resorted SystemJSON
    saveAllJSON(true);

    var newPos = SystemsJSON[id].sort;
    res.writeHead(200, {"Content-Type": "application/json"});
    res.end(JSON.stringify({newPos:newPos, oldPos:oldPos, otherId:otherId}));

});

//Service Rt: /getResults get last result file of the current component, Method: get, Requires: id = the id of component to be returning results of , Returns: the string contents of the last result file
router.get("/getResults",function(req,res) {
    var fileName = req.query.id;
    var results = fs.readFileSync(resultsPath + fileName + ".json");
    res.end(results)
});

//Not used
//Function: checkIfFile(file, cb)
// function checkIfFile(file, cb) {
//     fs.stat(file, function fsStat(err, stats) {
//         if (err) {
//             if (err.code === 'ENOENT') {
//                 return cb(null, false);
//             } else {
//                 return cb(err);
//             }
//         }
//         return cb(null, stats.isFile());
//     });
// };

//Service Rt: /resultsList get list of all results file names foir a given id, Method: get, Requires: id = the id of component to be returning results list of , Returns: new array of file names
router.get("/resultsList",function(req,res){
    var id = req.query.id;
    res.writeHead(200, {"Content-Type": "application/json"});

    //Read the results folder file list
    fs.readdir(resultsPath, function (err, files) {
        if (err) {
            throw err;
        } else {

            //Filter by id part of file name
            var resultsFileArray = [];
            files = files.filter(function (file) {
                return (file.substr(0, id.length) == id);
            });

            //Sort by the datetime part of each file (DEC)
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

//Service Rt: /saveId handle the saving of USER ID/PW info from setup UI, Method: post, Requires: new password & new password again , Returns: "Password saved" mess or error mess | updated user table (saved)
router.post("/saveId",function(req,res){

    var sess = req.session;
    var userId = sess.username;

    var reqJSON = req.body;
    var pw1 = reqJSON.newPassword;
    var pw2 = reqJSON.newPasswordAgain;

    //Are the new password the same?
    if(pw1 !== pw2){
        res.end("Passwords are not the same")
    }else if(pw1.length < 8){
        res.end("Password is less then 8 Chrs.")
    }else{

        //Find user in user table and update
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

//Service Rt: /save to save the current working or new component to SystemJSON & file save after save button click, Method: post, Requires: id = component ID , Returns: "Password saved" mess or error mess | updated user table (saved)
router.post("/save",function(req,res){
    //console.log("submit");

    var reqJSON = req.body;
    var id = reqJSON.id;
    var foundRow = {};

    //if component is not of type system
    if(req.body.comType !== "system"){
        var comType = "job";

        //If new
        if (id.length < 32){

            //Capture parent ID + family tree
            var pid = req.body.parent;
            var parentFamTree = SystemsJSON[pid].ft;

            //get number of siblings
            var x =0;
            for (var key in SystemsJSON) {
                if (SystemsJSON[key].parent === pid) {
                    x++;
                }
            }

            //initial history json
            var ds = new Date().toISOString();
            var hist=[{username:config.username, ds: ds, fromId: ""}];

            //Gen new ID
            id = generateUUID();

            //Build new OBJ
            foundRow = {parent:pid, ft:parentFamTree+'/'+pid, name:req.body.name, ver:1, enabled:1, promoted:0, rerunnable:0, systemFunction:0,  runLocal:0, comType: 'job', description: req.body.description, script:"", variables:{}, templates:{tempArr:[{"c":"", "t":""}]} , text:req.body.name, resourceFiles:[], sort:x};
            //append history json
            var ds = new Date().toISOString();
            var currentHist = [];
            currentHist.push({username:config.username, ds: ds, created: pid});
            foundRow.hist=currentHist;

            //append history json
            var ds = new Date().toISOString();
            var currentHist = [];
            currentHist.push({username:config.username, ds: ds, created: pid});
            foundRow.hist=currentHist;

            //Add row to SystemJSON
            SystemsJSON[id] = foundRow;

            //If not new
        }else{

        //Build new obj and move values over
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

        // newData.template = {"code":req.body.template, "type":req.body.templateType};
        newData.templates = req.body.templates

        newData.text = req.body.name;

        newData.resourceFiles = req.body.resourceFiles;

        //Move sort value over
        newData.sort = SystemsJSON[id].sort;

        //add history json to SystemsJSON if not there
        // if(!SystemsJSON[id].hasOwnProperty("hist")){
        //     SystemsJSON[id].hist = [];
        // }

        //append history json
        var ds = new Date().toISOString();
        var currentHist = SystemsJSON[id].hist;
        currentHist.push({username:config.username, ds: ds, fromId: ""});
        newData.hist=currentHist;

        //Increment component version number
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
        //Component type = System
        var comType = "system";

        //if new component
        if (id.length < 32){ //new
            var pid = '#';
            var x =0;

            //Count number of siblings
            for (var key in SystemsJSON) {
                if (SystemsJSON[key].parent === pid) {
                    x++;
                }
            }
            id = generateUUID();

            //initial history json
            var ds = new Date().toISOString();
            var hist=[{username:config.username, ds: ds, fromId: ''}];

            //Build new component obj
            foundRow = {parent:pid, ft:pid, name:req.body.name, ver:1, comType: "system", description: req.body.description, text:req.body.name, variables:{}, sort:x};

            //append history json
            var ds = new Date().toISOString();
            var currentHist = [];
            currentHist.push({username:config.username, ds: ds, created: pid});
            foundRow.hist=currentHist;

            //Add new system to SystemsJSON
            SystemsJSON[id] = foundRow;

            //Not new component
        }else{
            var newData = {};
            newData.parent = SystemsJSON[id].parent;
            //newData.ft = SystemsJSON[id].ft;
            newData.ft = "#";
            newData.comType =  "system";
            newData.description = req.body.description;
            newData.text = req.body.name;
            newData.name = req.body.name;
            newData.variables = req.body.sysVariables;
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

            //Inc version number
            if ( SystemsJSON[id].hasOwnProperty('ver') ) {
                newData.ver = SystemsJSON[id].ver + 1;
            }else{
                newData.ver = 1;
            }

            SystemsJSON[id] = newData;
            foundRow = SystemsJSON[id];
        }
    }

    //save new icon file
    if (reqJSON.hasOwnProperty('iconURL')){
        //if reqJSON.iconURL has data then a new icon has been copied to UI
        var base64Data = reqJSON.iconURL.replace(/^data:image\/png;base64,/, "");
        //console.log("base64Data: "+base64Data);
        if (base64Data !== '') {
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

    saveAllJSON(true);
    res.writeHead(200, {"Content-Type": "application/json"});
    foundRow.id = id;
    res.end(JSON.stringify(foundRow));

});

//Function: generateUUID() Generate unique id string, Requires: nothing , Returns:  unique string of format xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
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

//Service Rt: /copy to copy a specified component to the working SystemsJSON, Method: post, Requires: fromIds = list of ids to be copied seperated by ';' | targetId = new parent component id | lib = local or filename of source library, Returns: empty string or error string
router.post("/copy",function(req,res){
    var reqJSON= req.body;

    var fromIds =reqJSON.ids.split(';');
    var targetId = reqJSON.parent;
    var lib = reqJSON.lib;

    //If the specified source library is 'local' (ie the working library) varify each id exists then process each id
    if(lib === 'local'){
        var error = false;
        var errorID = '';

        //Set error flag if target not exist
        if ((!SystemsJSON.hasOwnProperty(targetId)) && (targetId !== '#')){
            error = true;
            errorID = targetId;
        }

        //set error flag if from ID not exist
        fromIds.forEach(function(id){
            if (!SystemsJSON.hasOwnProperty(id) && error === false ){
                error = true;
                errorID = id;
            }
        });

        //If no error
        if(error === false){

            //build id map of old parents and new parents
            var idMap = {};

            //add from parent and new parent to id map
            idMap[SystemsJSON[fromIds[0]].parent] = targetId;

            //count target siblings and give new sort number to 1st node
            var x =0;
            for (var key in SystemsJSON) {
                if (SystemsJSON[key].parent === targetId) {
                    x++;
                }
            }

            //loop through all fromIds and copy
            fromIds.forEach(function(fromId) {
                var fromNode = SystemsJSON[fromId];
                var id = generateUUID();

                //update parent id map
                idMap[fromId] = id;
                var newParentId = idMap[SystemsJSON[fromId].parent]
                //console.log('move to:'+SystemsJSON[newParentId].name);

                //initial history json
                var ds = new Date().toISOString();
                var hist=[{username:config.username, ds: ds, fromId: fromId}];

                //Build new component obj. Version 1
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

                //Add new family tree
                if(newParentId === "#"){
                    NewRow.ft = "#"
                }else{
                    NewRow.ft = SystemsJSON[newParentId].ft + '/' + newParentId;
                }

                //Add more properties to the new component obj if type = 'job' (ie component)
                if(fromNode.comType === 'job' ){
                    NewRow.enabled=fromNode.enabled;
                    NewRow.rerunnable=fromNode.rerunnable;
                    NewRow.promoted=fromNode.promoted;
                    NewRow.systemFunction=fromNode.systemFunction;
                    NewRow.runLocal=fromNode.runLocal;
                    NewRow.script=fromNode.script;
                    NewRow.variables=fromNode.variables;
                    //NewRow.template=fromNode.template;
                    NewRow.templates=fromNode.templates;
                    //NewRow.custTemplates=fromNode.custTemplates;
                    NewRow.resourceFiles=fromNode.resourceFiles;
                    NewRow.icon=fromNode.icon;
                }

                SystemsJSON[id] = NewRow;

                //Copy file resources
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

            //add new sort order value to the 1st id
            SystemsJSON[idMap[fromIds[0]]].sort = x;

            //Save SystemsJSON and backup
            saveAllJSON(true);

            //Return OK status
            res.sendStatus(200);
            res.end('');
            //console.log("saving script"+ JSON.stringify(foundRow));

        }else{
            //error detected. Return error message
            res.sendStatus(500);
            res.end("Error:System ID not found - " + errorID)
        }
    }else{
        //The source library is not the working lib

        //Create error flag
        var error = false;
        var errorID = '';

        //Validate target ID
        if ((!SystemsJSON.hasOwnProperty(targetId)) && (targetId !== '#')){
            error = true;
            errorID = targetId;
            console.log("Target ID not found in SystemsJSON: " + errorID);
        }

        //Open and parce the source lib from the file system
        libJSON = JSON.parse(fs.readFileSync("library/" + lib + "/SystemsJSON.json"));
        fromIds.forEach(function(id){
            if (!libJSON.hasOwnProperty(id) && error === false ){
                error = true;
                errorID = id;
                console.log("From ID not found in lib: " + errorID);
            }
        });

        //If no error detected
        if(error === false){
            //build id map of old parents and new parents
            var idMap = {};
            idMap[libJSON[fromIds[0]].parent] = targetId;

            //count target siblings and give new sort number to 1st node
            var x =0;
            for (var key in libJSON) {
                if (libJSON[key].parent === targetId) {
                    x++;
                }
            }

            //loop through all fromIds and copy
            fromIds.forEach(function(fromId) {
                var fromNode = libJSON[fromId];

                //New id
                var id = generateUUID();

                //update parent id map
                idMap[fromId] = id;
                var newParentId = idMap[libJSON[fromId].parent];

                //initial history json
                const ds = new Date().toISOString();
                const hist=[{username:config.username, ds: ds, fromId: fromId}];

                //build new component object version 1
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

                //build family tree string
                if(newParentId === "#"){
                    NewRow.ft = "#"
                }else{
                    NewRow.ft = SystemsJSON[newParentId].ft + '/' + newParentId;
                }

                //Add more properties to the new component obj if type = 'job' (ie component)
                if(fromNode.comType === 'job'){
                    NewRow.ft = SystemsJSON[newParentId].ft + '/' + newParentId;
                    NewRow.enabled=fromNode.enabled;
                    NewRow.rerunnable=fromNode.rerunnable;
                    NewRow.promoted=fromNode.promoted;
                    NewRow.systemFunction=fromNode.systemFunction;
                    NewRow.runLocal=fromNode.runLocal;
                    NewRow.script=fromNode.script;
                    // NewRow.template=fromNode.template;
                    NewRow.templates=fromNode.templates;

                    // NewRow.custTemplates=fromNode.custTemplates;
                    NewRow.resourceFiles=fromNode.resourceFiles;
                    NewRow.icon=fromNode.icon;
                // }else{
                //     NewRow.icon=fromNode.icon;
                }

                //Add to SystemsJSON
                SystemsJSON[id] = NewRow;

                //create libPath string
                const libPath = libsPath + lib + "/";

                //copy resource files
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

            //add new sort order value to the 1st id
            SystemsJSON[idMap[fromIds[0]]].sort = x;

            //Save SystemsJSON and backup
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

//Service Rt: /copyToLib to copy a specified component to a specified library SystemsJSON, Method: post, Requires: fromIds = list of ids to be copied seperated by ';' | targetId = new parent component id | lib = local or filename of source library, Returns: empty string or error string
router.post("/copyToLib",function(req,res){
    var reqJSON= req.body;

    //Get fromIds and filter out bad ones
    var fromIds =reqJSON.ids.split(';').filter(Boolean); //https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Boolean
    var targetId = reqJSON.parent;
    var lib = reqJSON.lib;

   //If targetId is 'lib' then set the target id to 'root' of tree
    if(targetId === 'lib'){
        targetId = '#'
    }

    //Open specified lib from file system
    libJSON = JSON.parse(fs.readFileSync("library/" + lib + "/SystemsJSON.json"));

    //create error flag
    var error = false;
    var errorID = '';

    //varify targetId
    if ((!libJSON.hasOwnProperty(targetId)) && (targetId !== '#')){
        error = true;
        errorID = targetId;
        res.sendStatus(500);
        console.log("Error:Target ID not found in library system json - " + errorID);
        res.end("")
    }

    //Verify fromIds
    fromIds.forEach(function(id){

        if (!SystemsJSON.hasOwnProperty(id) && error === false ){
            error = true;
            errorID = id;
            res.sendStatus(500);
            console.log("Error:Source ID not found in system json - " + errorID);
            res.end("")
        }
    });

    //If no error
    if(error === false){

        //build id map of old parents and new parents
        var idMap = {};
        idMap[SystemsJSON[fromIds[0]].parent] = targetId;

        //find out how many nodes in this branch to use for sort placement
        var x =0;
        for (var key in libJSON) {
            if (libJSON[key].parent === targetId) {
                x++;
            }
        }

        //build lib path
        const libPath = __dirname + "/library/" + lib;

        //loop through each id
        fromIds.forEach(function(fromId) {
            var fromNode = SystemsJSON[fromId];

            //gen new id
            var id = generateUUID();

            //add old id & new id to parent map
            idMap[fromId] = id;
            var newParentId = idMap[SystemsJSON[fromId].parent];

            //build new component object
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

            //build family tree string
            if(newParentId === "#"){
                NewRow.ft = "#"
            }else{
                NewRow.ft = libJSON[newParentId].ft + '/' + newParentId;
            }

            //if type = job (component) then copy other prpoerties
            const nodeType = fromNode.comType;
            if (nodeType === 'job' ){
                NewRow.script=fromNode.script;
                // NewRow.template=fromNode.template;
                NewRow.templates=fromNode.templates;
                // NewRow.custTemplates=fromNode.custTemplates;
                NewRow.resourceFiles=fromNode.resourceFiles;
                NewRow.rerunnable=fromNode.rerunnable;
                NewRow.promoted=fromNode.promoted;
                NewRow.systemFunction=fromNode.systemFunction;
                NewRow.runLocal=fromNode.runLocal;
                NewRow.enabled=fromNode.enabled;
            }

            //Add new row to lib json
            libJSON[id] = NewRow;

            //copy file resources if they exist
            if ( fs.existsSync( filesPath + fromId ) ) {
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

        //set sort order
        libJSON[idMap[fromIds[0]]].sort = x;

        //Save library
        fs.writeFile(libPath + '/SystemsJSON.json', JSON.stringify(libJSON), function (err) {
            if (err) {
                console.log('There has been an error saving your library json');
                console.log(err.message);
            }
            //console.log('json saved successfully.')
        });

        //return OK status
        res.sendStatus(200);
        res.end('');
    }
});

//Service Rt: /libraryList to get a list of public and private libs then exist on this builder instance, Method: get, Requires: nothing , Returns: json string of format {pri:priFiles, pub:pubFiles}
router.get("/libraryList",function(req,res){
    res.writeHead(200, {"Content-Type": "application/json"});

        var priFiles = fs.readdirSync(libsPath + "/private");
        var pubFiles = fs.readdirSync(libsPath + "/public");
        const respObj = {pri:priFiles, pub:pubFiles};
        res.end(JSON.stringify(respObj));
});

//Function: getSystemVarVal(jobId, vari) to get the value of a specified variable in the system of a specified component, Requires: jobId = id of component | vari = name of system variable  , Returns:  value of variable or nothing
function getSystemVarVal(jobId, vari){
    if (SystemsJSON.hasOwnProperty(jobId)){
        var ft = SystemsJSON[jobId].ft;
        var sysId = ft.split('/')[1];
        var varListAr = SystemsJSON[sysId].variables;

        if(varListAr){
            return(varListAr[vari] ? varListAr[vari].value : "");
        }else{
            return "";
        }
    }else{
        return('');
    }

}

//experimental gif encoding. not used
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

//build global variables to cache results variables for fast lookups during runs
var latestResultsFileList = [];
var latestVarCache = {};

//Service Rt: /run to build a list of components. Disabled components and thier children will be skipped, Method: post, Requires: ids = list of ids to build seperated by ';' , Returns: A very long chunked responcse containg ssh output and imbedded codes to update the ui
router.post("/run",function(req,res){

    var job;
    var jobIndex;
    var ids;
    var storeLocal;
    var runKey="";
    var newKey=false;
    var runAccess="";
    var newAccess=false;

    //the ssh connect obj
    var conn;

    //users remote ip
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
    //save file with remote ip
    fs.writeFileSync("sec_group_ips.json",JSON.stringify({'builderIP':builderIP, 'remoteIP':remoteIP}))

    //set default timeout. May be over written by user prefs
    var timeOut = 30000;  //By default - how many ms all connections should wait for the prompt to reappear before connection is terminated

    //lookup user pref timeout value
    const timeoutNumber = parseInt(config.timeout);
    //console.log("timeoutNumber: " + timeoutNumber)
    if (timeoutNumber > 0 ){ //If config holds timeout, use it.
        timeOut = timeoutNumber
    }

    var lastTimeout;
    var exportVar = "";

    //formidable used to parce form
    var form = new formidable.IncomingForm();
    form.parse(req, function(err, fields, files) {
        if(err){
            console.log(err);
            //message(err);
        }else{

            //set list of ids into ids array
            ids = fields.ids.split(';');

            //storeLocal holds val of 'store key in browser' checkbox
            var storeLocal = fields.storeLocal;
            //if key-pair file is attached
            if(files.hasOwnProperty('key')   ){
                //capture the key-pair in runKey and delete the attached file
                var myFiles = files['key'];
                if (myFiles.hasOwnProperty('path')) {
                    runKey = fs.readFileSync(myFiles.path);
                    newKey = true;
                    fs.unlink(myFiles.path,function(err){
                        if(err) console.log('Error: unable to delete uploaded key file')
                    });
                }
            }else{
                if(storeLocal === 'yes'){
                    if(fields.hasOwnProperty('localStoredKey')){
                        runKey = fields.localStoredKey;
                        //console.log('runKey local: ' + runKey);
                    }
                }
            }

            //storeLocalAccess holds val of 'store access key in browser' checkbox
            var storeLocalAccess = fields.storeLocalAccess;
            if(files.hasOwnProperty('access')   ){
                var myFiles = files['access'];

                //if runAccess file is attached
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

    //queue to store messages to to sent to ui
    var messQueue = [];

    //function to push messesages to queue
    function message(mess) {
        messQueue.push(mess)
    }

    //function to flush messesages from queue ti ui and results file
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

    //function conTimeout () to perforn action when no prompt timeout occures
    function conTimeout () {
        console.log('SSH2 conn timed out ' + timeOut.toString());
        message("No prompt detected " + timeOut.toString() + " ms");
        flushMessQueue();
        //res.write("message:No prompt detected " + timeOut.toString() + " ms") ;
        conn.end();
     }

     //function to return file names array of latest results of all componnents
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


    //function to parse all results files in latestResultsFileList and cache all results variables (var:key:val)
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
        var varListAr = SystemsJSON[systemId].variables;
        if(typeof latestVarCache[systemId] === 'undefined'){
            latestVarCache[systemId] = {};
        }
        for(var thisVar in varListAr){
            var kName = thisVar;
            var kVal = varListAr[thisVar].value;
            latestVarCache[systemId][kName] = kVal
        }
        // varListAr.forEach(function(pair){
        //
        //     //console.log("found: id:" + systemId + " varName:" + kName + "=" + JSON.stringify(latestVarCache[systemId][kName]))
        // });
    }

    //disply results of cacheVarVals in log
    console.log("complete cacheVarVals - " + Object.keys(latestVarCache).length.toString() + " results files" );

    //function runScript to build a specified component. requires: jobId = job id string | job = component obj , runMethod = "exec" or "SSH"
    function runScript(jobId, job, runMethod) {
        var script = job.script + "\n"; //add return to end of string to ensure prpompt is returned at end of script
        var scriptArray = script.split("\n"); // the list of commands by row

        if (runMethod === "exec") {
            scriptArray.forEach(function (item) {
                // var cmd = item;
                // exec(cmd, function (error, stdout, stderr) {
                //     //console.log("out:" + stdout);
                //     //res.write(stdout);
                //     res.end(stdout)
                // });
            });
        } //experimental not used

        //create ssh connection
        if (runMethod === "SSH") {
            var sshSuccess = false; //error flag creation

            conn = new Client(); //connection obj

            var exportCommand = "";// holds command to be exported (saved as variable) flag

            //meggege ui that build is starting for the current job
            message('Building:' + job.name);
            message('BuildID:[' +jobId+ ']'); //send id to trigger ui functions


            //connection error event. Message UI
            conn.on('error', function (err) {
                console.log('SSH - Connection Error: ' + err);
                message('SSH - Connection Error: ' + err);
                flushMessQueue();
                res.end("status:Scripts Aborted\n");
            });

            //connection (job run) end event. Run next job in list or send success message or error message
            conn.on('end', function () {
                jobIndex++;

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

            //connection ready event. create shell and send commands
            conn.on('ready', function () {
                var commandIndex = 0;
                var prompt = "[SysStack]"; //prompt will be chaned to this
                var atPrompt = false; //flag to indicate if prompt returned
                var aSyncInProgress = 0; //counter to indicate number of async processes in flight
                var deferredExit = false; //flag to indicate async processes exist
                var respBufferAccu = new Buffer([]); //responce buffer

                resultsArray = []; //global array to hold resuktes key vals init

                //spawn a command shell
                conn.shell(function (err, stream) {
                    if (err) throw err;

                    //close event to update ui, save log

                    stream.on('close', function (code, signal){
                        var dsString = new Date().toISOString(); //date stamp

                        clearTimeout(lastTimeout);

                        //message ui
                        message("Completed " + job.name);
                        message(sshSuccess === true ? "CompletionSuccess:true\n" : "CompletionSuccess:false\n");
                        flushMessQueue();

                        //format date string
                        var fds = dsString.replace(/_/g, '-').replace(/T/, '-').replace(/:/g, '-').replace(/\..+/, '');
                        var fileName = "";

                        //update SystemsJSON component with pass or fail and build results file name
                        if (sshSuccess === true) {
                            SystemsJSON[jobId].lastBuild = {ct:fds,pass:1};
                            fileName =  jobId + '_' + fds + '_p.json';
                        } else {
                            SystemsJSON[jobId].lastBuild = {ct:fds,pass:0};
                            fileName = jobId + '_' + fds + '_f.json';
                        }


                        //save results file and cache vars to lookup - latestVarCache[Id][varName]
                        fs.writeFile(resultsPath + fileName, JSON.stringify(resultsArray), function (err) {
                            if (err) {
                                console.log('There has been an error saving your json.\n'+err.message);
                            }else{
                                if(typeof latestVarCache[jobId] === 'undefined'){
                                    delete latestVarCache[jobId]
                                }
                                cacheVarVals([fileName],job.ft.split('/')[1]);

                                //If this is a special 'system' job then update the system variables
                                if(SystemsJSON[jobId].systemFunction === 1){
                                    copySystemVarToSystem(jobId)
                                }

                                //save SystemsJSON no backup

                                conn.end();
                            }

                        });
                        saveAllJSON(false);

                        //function to update system variables if job = system job. Used to set host etc.
                        //eg var:systemVar:host=1.2.3.4 will add/change host variable in the system to a value of 1.2.3.4
                        function copySystemVarToSystem(id){

                            if(typeof SystemsJSON[id] !== "undefined") {

                                var resultsSystem = SystemsJSON[id].ft.split('/')[1];
                                if(SystemsJSON[resultsSystem].variables){
                                    if(latestVarCache[id]){
                                        //loop through each var in this job
                                        //if one is systemVar get the value and add/update in in system
                                        for(varName in latestVarCache[id]){
                                            if(varName === "systemVar"){
                                                var newVar = latestVarCache[id][varName];
                                                SystemsJSON[resultsSystem].variables[newVar.split("=")[0]] = {value:newVar.split("=")[1], private: false, type: "Text"}
                                            }
                                        }
                                        saveAllJSON(false)
                                    }
                                }
                            }
                        }
                    });

                    //event when data is returned on ssh session
                    stream.on('data', function (data) {

                        //send data to ui
                        res.write(data.toString());

                        //Accumulate to buffer until the prompt appears
                        respBufferAccu = Buffer.concat([respBufferAccu, data]);


                        //var tempVal = respBufferAccu.toString();

                        //if the response contains the current prompt string send next command and process directives
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

                             //if all commands have been sent
                            if (commandIndex === scriptArray.length) {
                                commandIndex++;

                                //exit stream if no async processes
                                if (aSyncInProgress < 1){
                                    stream.write("exit" + '\n');
                                    sshSuccess = true
                                }else{ //otherwise set deferredExit flag
                                    message('Waiting for asynchronous processes to complete...');
                                    deferredExit = true
                                }
                                flushMessQueue();
                            }
                        };

                        //Function to create response obj to add to results file
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

                        //function to send next command to ssh stream
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

                        //function to process the directives on the current command .
                        function processDirectives(){
                            do{
                                // console.log("commandIndex: " + commandIndex);
                                // console.log("process:" + currentCommand);
                                // console.log("");

                                var isDirective = false;//flag to indicate current command was indeed a directive

                                //parse each line and search for directives. while found it is processed and the next line is parsed
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

                                    var template = "";
                                    var pathFileName = "";

                                    var tempNum = parseInt(currentCommand.split(':')[1], 10);
                                    if (tempNum > 1 && tempNum < 100) {
                                        template = job.templates.tempArr[tempNum - 1].c;
                                        pathFileName = currentCommand.substr(currentCommand.indexOf(":") + 1);
                                        pathFileName = pathFileName.substr(pathFileName.indexOf(":") + 1);
                                    }else{
                                        template = job.templates.tempArr[0].c;
                                        pathFileName = currentCommand.substr(currentCommand.indexOf(":") + 1);
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
                                            //var chownResp = execSync("sudo chown " + getSystemVarVal(jobId, 'username') + ":" + getSystemVarVal(jobId, 'username') + ' /tmp/' + aFileName);
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
                                                                //console.log("sudo chown " + getSystemVarVal(jobId, "username") + ":" + getSystemVarVal(jobId, "username") + " " + pathFileName);
                                                                //Execute sudo chown to change file ownership to the user as defined in the system
                        conn.exec("sudo chown " + getSystemVarVal(jobId, "username") + ":" + getSystemVarVal(jobId, "username") + " " + pathFileName, function(err, stream) {
                                    if (err) throw err;
                                    stream.on('close', function(code, signal) {
                                        //console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
                                        //conn.end();
                                    }).on('data', function(data) {
                                        console.log('STDOUT: ' + data);
                                    }).stderr.on('data', function(data) {
                                        console.log('STDERR: ' + data);
                                    });
                                });
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
                                    message('url:' + url);
                              //      flushMessQueue();
                                    (async function () {

                                        console.log("Page.navigate: " + url)

                                        await Page.navigate({url: url});
                                        await Page.loadEventFired();

                                        console.log("Page.loadEventFired: " + url)

                                       // message('snap:created: ' + "screenshot.png");

                                        aSyncInProgress--;
                                        if(deferredExit == true && aSyncInProgress == 0){
                                                stream.write("exit" + '\n');
                                                sshSuccess = true
                                            }

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

                         //function to replace the embedded var references with values. Returns new formatted commandStr
                        function replaceVar(commandStr, job) {// find and replace inserted command vars eg. <%p.mVar4%>

                            const items = commandStr.split(new RegExp('<%', 'g'));
                            items.forEach(function (item) {
                                item = item.substr(0, item.indexOf('%>'));

                                if (item.length > 2 && item.length < 32 && item.substr(0, 2) == 'c.') {
                                    var targetVarName = item.substr(2);
                                    var pid = job.parent;
                                    var repStr = "<%c." + targetVarName + "%>";
                                    if(job.variables[targetVarName]){
                                        var val = job.variables[targetVarName].value;
                                        commandStr = commandStr.replace(repStr, val)
                                    }
                                }; //look in job for vars

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
                                }; //look in parent for vars

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
                                }; //look in ancestors for vars

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




                                }; //look in same system for vars

                                //function to return number of ancestors the current running job has in common with the found var job. Requires: jobFT and foundFT job ID strings separated by "/".
                                function calcRelativeScore(jobFT, foundFT){//how many gr/parents does the current running job have in common with the found var job..
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
                    stream.write('stty cols 200' + '\n' + "PS1='[SysStack]'" + '\n'); //set prompt
                    lastTimeout = setTimeout(conTimeout, timeOut);
                });
             });

            //Try to connect to the host
            try {
                var connectHost;

                //If commponent is set 'run local' set connectHost to local host (127.0.0.1) otherwise use system var 'host' value and 'username' value
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

//Service Rt: /getVars to return a list of all vars in current system , Method: get, Requires: nothing , Returns: json string of format {pri:priFiles, pub:pubFiles}
//The service is to be rewritten utalizing new lookups
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
            }); //include most recent of each id

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

//Service Rt: /upload to upoad file and attach to specified id, Method: post, Requires: form including id = component ID | uploads = file list , Returns: array of files attached to component format {name:file} or Error String
router.post("/upload",function(req,res){ //https://coligo.io/building-ajax-file-uploader-with-node/

    // create an incoming form object using formidable;
    var form = new formidable.IncomingForm();

    form.parse(req, function(err, fields, files) {

        if(err){
            res.end(err)
        }

        var id = fields.id;
        //if id exists check ./uploads/[id] file path. Create if not. Save files. Build return array.
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
                    });
                    //Return list of files that were successfully saved.
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

//Service Rt: /uploads/*", "/library/* to provide access to resources in ./library and ./uploads, Method: get, Requires: nothing , Returns: stream of the file specified in url
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

router.get("/fileList",function(req,res){
    var id = req.query.id;

    fs.readdir(filesPath + id + '/' , function(err, files){
        if(err){
            //console.log(err);
            res.end(JSON.stringify([]))
        }else{
            var returnArr = [];
            files.forEach(function(file){
                returnArr.push({name:file})
            });
            res.end(JSON.stringify(returnArr))
        }

    })

});


//Service Rt: /delFiles to delete specified component resource files from ./upload dir, Method: get, Requires: id = id of component to remove resource from | files = resource file names string seperated by ';' , Returns: array of files successfully deleted format {name:file} or error string
router.get("/delFiles",function(req,res){
    var id = req.query.id;
    var filesBlob = req.query.files.split(';');
    if (fs.existsSync(filesPath +id) && id.length > 32) {

        //create array of file names
        filesBlob.forEach(function(myFile){
            if (myFile.trim().length > 0){
                try{ //try to delete file
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

//Service Rt: /getStyle to return a style sheet , Method: get, Requires: styleName = name of style to be used . specify 'dark' for dark style else default syle will be used  , Returns: syle encoded in json obj format {css: cssJson}
//Note that this service is to be improved by allowing user to select from a dynamic list of styles. Currently hardcoded with 'dark' or default.
router.get("/getStyle",function(req,res){
    var styleName = req.query.styleName;

    //If user config does not have property to store style then add default as current style.
    if(!config.hasOwnProperty('currentStyle')){
        saveSettings("currentStyle", 'default')
    }

    if (styleName === '') {
        styleName = config.currentStyle;
    }

    //if user specified 'dark'
    if (styleName === 'dark') {//return dark.css
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
    }else{ //return default.css
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

//Service Rt: /ClosestRerunnableAn to return object containing the closest ancestor that is rerunnable, Method: get, Requires: id = id of the component to search for ancestor, Returns: id of closest rerunnable ansester and the SytemsJSON row of the same. format {id:ClosestRerunnableAnID, ClosestRerunnableAn:ClosestRerunnableAn}
//Note that this service requires improvments to return current component if it is rerunnable.
router.get("/ClosestRerunnableAn",function(req,res){
    var id = req.query.id;

    var ClosestRerunnableAn = {};
    var ClosestRerunnableAnID = "";
    if (SystemsJSON.hasOwnProperty(id) ){
        if(SystemsJSON[id].rerunnable !== 1){
            var parentID = SystemsJSON[id].parent;
            var x = 0;
            //loop through parent > parent > parent etc (max 100 times) and capture compont that is rerunnable.
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

//Service Rt: /setTimeout set user config timeoout preference, Method: post, Requires: timeout = number of ms to set timeout to, Returns: confirmation string or error string
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

//Service Rt: /setnoClientTimeout set user config no client timeout preference, Method: post, Requires: noClientTimeout = number of minutes to wait without a client calling any service, Returns: confirmation string or error string
router.post("/setnoClientTimeout",function(req,res){

    var reqJSON = req.body;
    var timeout = reqJSON.noClientTimeout;
    const timeoutNumber = parseInt(timeout);

    if(timeoutNumber > 0) {
        if( !saveSettings("noClientTimeout", timeout) ){
            res.write("No client timeout set to " + timeout + " minutes")
        }else{
            res.write("Error setting no client timeout")
        }
    }else{
        res.write("No client timeout not set. Must be greater than 0 minutes")
    }
    res.end('')
});


//Service Rt: /setUsername set user config username preference, Method: post, Requires: username = user specified username, Returns: confirmation string or error string
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

//Service Rt: /settings to return all user config seetings, Method: post, Requires: none, Returns: JSON string obj
router.get("/settings",function(req,res){
    res.writeHead(200, {"Content-Type": "application/json"});

    const respObj = config;
    res.end(JSON.stringify(respObj));
});

//Service Rt: /firstRun to set firstrun flag in config, Method: post, Requires: nothing, Returns: confirmation string or error string
router.post("/firstRun",function(req,res){

    if( !saveSettings("firstRun", 1) ){
        res.write("firstRun set")
    }else{
        res.write("Error setting firstRun")
    }
    res.end('')
});

//Service Rt: /getPromotedSystems to return a sorted array of SystemJSON rows where promoted === 1 , Method: get, Requires: none, Returns: Obj of working SystemJSON rows eg. {id:name, id2:name2}
router.get("/getPromotedSystems",function(req,res){
    var rowdata={};
    var resJSON = [];
    for (var key in SystemsJSON) {
        if (SystemsJSON.hasOwnProperty(key)) {
            if(SystemsJSON[key].promoted === 1){

                var  hostIP = getSystemVarVal(key, "host");

                if(hostIP !=="" || SystemsJSON[key].runLocal === 1){
                    var systemName =  SystemsJSON[SystemsJSON[key].ft.split("/")[1]].name;
                    var systemId =  SystemsJSON[key].ft.split("/")[1];
                    rowdata[systemId] = systemName
                }
            }
        }
    };
    res.end(JSON.stringify(rowdata));
});

//Service Rt: /getPromoted to return a sorted array of SystemJSON rows where promoted === 1 and systemId === id of system to include. Rows where its system does not have a hostip defined will be excluded unless it has runlocal set. , Method: get, Requires: none, Returns: array of working SystemJSON systems plus added properties (id, systemName, systemId)
router.get("/getPromoted",function(req,res){
    //fixSystemsJSONSort();  //no longer required?

    var systemId = req.query.systemId;
    var rowdata={};
    var resJSON = [];
    for (var key in SystemsJSON) {
        if (SystemsJSON.hasOwnProperty(key)) {
            if(SystemsJSON[key].promoted === 1){

                var  hostIP = getSystemVarVal(key, "host");

                if(SystemsJSON[key].ft.split("/")[1] == systemId){
                    if(hostIP !=="" || SystemsJSON[key].runLocal === 1){
                        rowdata = JSON.parse(JSON.stringify(SystemsJSON[key]) );
                        rowdata.id = key;
                        rowdata.systemName =  SystemsJSON[rowdata.ft.split("/")[1]].name;
                        rowdata.systemId =  rowdata.ft.split("/")[1];

                        //convert family tree+key string to string containing sort values eg ?1?2?1?6?3
                        var sortStr = " ";
                        var sArr = rowdata.ft.split('/');
                        sArr.push(key);
                        sArr.forEach(function(parent_id){
                            sortStr += parent_id.length>20 ? "?" + SystemsJSON[parent_id].sort.toString() : "";
                        });

                        rowdata.sortStr = sortStr;

                        resJSON.push(rowdata);
                    }
                }
            }
        }
    };

    //sort all rows by sort property
    resJSON.sort(function(a, b){
        var keyA = a.sortStr,
            keyB = b.sortStr;

        if(keyA < keyB) return -1;
        if(keyA > keyB) return 1;
        return 0;
    });

    res.end(JSON.stringify(resJSON));
});


// function fixSystemsJSONSort(){
//     for (var key in SystemsJSON) {
//         if (SystemsJSON.hasOwnProperty(key)) {
//
//             if(!SystemsJSON[key].hasOwnProperty("sort")){
//                 var allSibs = [];
//                 for (var skey in SystemsJSON) {
//                     if(SystemsJSON[key].parent === SystemsJSON[skey].parent){
//                         allSibs.push(skey)
//                     }
//                 }
//                 let x=0;
//                 allSibs.forEach(function(sib){
//                     SystemsJSON[sib].sort = x;
//                     x++
//                 })
//             }
//         }
//     }
// }

router.get("/setEnable",function(req,res){
    const id = req.query.id;
    const checked = req.query.checked;

    if (SystemsJSON.hasOwnProperty(id)) {
        if(checked === "true") {
            SystemsJSON[id].enabled = 1
        }else{
            SystemsJSON[id].enabled = 0
        }
        saveAllJSON(false)
    }
    res.end(JSON.stringify({enabled:SystemsJSON[id].enabled}));
});

router.get("/getTempTypes",function(req,res){

    let resJSON = {types: ["javascript", "sh", "text", "css", "ejs", "html", "json"]}


    res.end(JSON.stringify(resJSON));
});

//Service Rt: /getCPUStats to return an array of CPU stats of the current server , Method: get, Requires: none, Returns: array of stats in the format {last10:[val], last50:[val], last100:[val], freeMem:[val]}
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
var samples = []; //global to store cpu stats
var prevCpus = os.cpus(); //global to hold previous cpu stats

setInterval(sample,1000); //run function 'sample()' every 1000 ms
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

var secureServer = https.createServer({
    key: fs.readFileSync('./ssl/server.key'),
    cert: fs.readFileSync('./ssl/server.crt'),
    requestCert: true,
    rejectUnauthorized: false
}, app).listen('8443', function() {
    console.log("Secure Express server listening on port 8443");
});
//http.createServer(app).listen('80');
//console.log("Express server listening on port 80");

console.log(new Date().toISOString());



