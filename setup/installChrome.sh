#!/usr/bin/env bash
sudo rm -f /etc/yum.repos.d/google-chrome.repo
sudo touch /etc/yum.repos.d/google-chrome.repo
sudo chmod 666 /etc/yum.repos.d/google-chrome.repo

sudo echo -e "[google-chrome]\nname=google-chrome\nbaseurl=http://dl.google.com/linux/chrome/rpm/stable/\$basearch\nenabled=1\ngpgcheck=1\ngpgkey=https://dl-ssl.google.com/linux/linux_signing_key.pub" >> /etc/yum.repos.d/google-chrome.repo

sudo touch /etc/yum.repos.d/centos.repo
sudo chmod 666 /etc/yum.repos.d/centos.repo

sudo echo -e "[CentOS-base]\nname=CentOS-6 - Base\nmirrorlist=http://mirrorlist.centos.org/?release=6&arch=x86_64&repo=os\ngpgcheck=1\ngpgkey=http://mirror.centos.org/centos/RPM-GPG-KEY-CentOS-6\n\n" >> /etc/yum.repos.d/centos.repo

sudo echo -e "#released updates\n[CentOS-updates]\nname=CentOS-6 - Updates\nmirrorlist=http://mirrorlist.centos.org/?release=6&arch=x86_64&repo=updates\ngpgcheck=1\ngpgkey=http://mirror.centos.org/centos/RPM-GPG-KEY-CentOS-6\n\n" >> /etc/yum.repos.d/centos.repo

sudo echo -e "#additional packages that may be useful\n[CentOS-extras]\nname=CentOS-6 - Extras\nmirrorlist=http://mirrorlist.centos.org/?release=6&arch=x86_64&repo=extras\ngpgcheck=1\ngpgkey=http://mirror.centos.org/centos/RPM-GPG-KEY-CentOS-6\n" >> /etc/yum.repos.d/centos.repo

sudo yum install -y google-chrome-stable
sudo chmod 600 /etc/yum.repos.d/google-chrome.repo
sudo chmod 600 /etc/yum.repos.d/centos.repo

sudo yum -y install gnu-free-sans-fonts

google-chrome-stable --version
