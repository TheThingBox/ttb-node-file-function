# file_function node

## Function

Forked and modified from node-RED file-function node :

https://www.npmjs.com/package/node-red-contrib-file-function

This node is just like the core node "function", only that this node loads the script to be executed from an actual file on your drive.
If no script with the specified name exists on your drive, it creates it.

The file name can be set in the configuration panel, or dynamically via the msg.filename, msg.file, msg.value, or else msg.payload attribute. 
It sends the results in msg.payload.

## Dependencies

This node uses several NPM packages : 
- util
- vm
- fs
- path

## Tutorial

There is no tutorial for the moment.
