cwise-compiler
==============
Just the compiler from cwise.  You can call this directly if you know what you are doing and want to skip calling cwise-parser and including esprima.  This is only recommended in extreme cases though.  Otherwise you should stick to the default interface in cwise and not mess around with this craziness.

## Install

    npm install cwise-compiler

## `require("cwise-compiler")(procedure)`
Compiles a cwise procedure for the given procedure.  The object procedure must have the following fields:

* `argTypes` An array of argument types (as in cwise)
* `shimArgs` An array of arguments passed into the compiled procedures
* `arrayArgs` A list of indices

