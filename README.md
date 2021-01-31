![/builder](https://github.com/sbgh/builder/raw/master/static/images/server.png "/builder") | [/builder](https://EZStackSystems.com)
--- | --- 

[https://EZStackSystems.com](https://EZStackSystems.com)

---
## Programmatically build web servers

[/builder](https://EZStackSystems.com) is a general purpose, personal, server configuration manager built with Node.js. Allows you to easily build and deploy web services and applications (webpage/etc) on any Linux cloud or private server. Builder is a proof of concept and is currently in development phase.


## Installation

The current version of /builder and the packaged example components are intended to be installed on a 'fresh' Amazon AWS [EC2](https://us-west-2.console.aws.amazon.com/ec2/) instance (Amazon Linux 2 t3.medium).

### Automated installation

The automated installation will download the latest /builder code from Github and install all dependencies required to run /builder.
These dependencies include Node.js, NPM, headless Chrome, unzip and several Node.js extensions.

From the ec2-user home directory execute:
```
curl -L https://raw.githubusercontent.com/sbgh/builder/master/setup/builderSetup.sh > builderSetup.sh
chmod 700 builderSetup.sh
./builderSetup.sh
```

/builder listens on port 8443. Ensure that you create a new inbound rule that allows port 8443.
Access the /builder application via https://your.ip.address.or.hostname:8443/builder.
You will encounter an error 'ERR_CERT_AUTHORITY_INVALID' because the https Certificate Authority (CA) is not valid (self-signed). Select advanced and proceed (add exception).
You can start or restart the server by executing `./builder/restartServer.sh` from the ec2-user home directory.
At the login prompt, the username is Admin and the password is the one you chose during installation. 


