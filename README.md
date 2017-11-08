![/builder](http://systemssolutiondesigner.com/images/Blk_Cloud_sm.png "/builder") | [/builder](http://systemssolutiondesigner.com)
--- | --- 

[http://systemssolutiondesigner.com](http://systemssolutiondesigner.com)

---
## Programmatically build web servers

[/builder](http://systemssolutiondesigner.com) is a general purpose, personal, server configuration manager built with Node.js. Allows you to easily build and deploy web services and applications (webpage/etc) on any Linux cloud or private server. Builder is a proof of concept and is currently in development phase.

## Full software stack management

/builder allows you to be creative by stacking components. A component is a modular container of code, images, build/test scripts and other assets. /builder links the components together and deploys onto your server automatically. 

## Add new abilities to your server by dropping them in

Drag and drop components into a new context. Edit the component variables then click build. Headless Chrome is used to display the web app being rebuilt. 

![/builder](http://systemssolutiondesigner.com/images/add_phone_field.gif "/builder") 

## Installation

The current version of /builder and the packaged example components are intended to be installed on an Amazon AWS [EC2](https://us-west-2.console.aws.amazon.com/ec2/) instance (RHEL-7.3 t2.micro).

### Automated installation

The automated installation will install all dependencies required to run /builder in a new EC2 instance.
These dependencies include Node.js, NPM, headless Chrome, unzip and several Node.js extensions.

From the ec2-user home directory execute:

```curl -L systemssolutiondesigner.com/builderSetup.sh > builderSetup.sh
chmod 700 builderSetup.sh
./builderSetup.sh```







