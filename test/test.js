"use strict"
var parse = require("cwise-parser")
var compile = require("../compiler.js")
var ndarray = require("ndarray")
var ops = require("ndarray-ops")

require("tape")("basic tests", function(t) {
  var p = parse(function(a,b) {
      a = b[0]+b[1]+1
  })

  // Test with block index at the front of the indices
  var c = compile({
    args: ["array", {blockIndices: 1}],
    pre: parse(function() {}),
    body: p,
    post: parse(function() {}),
    debug: false,
    funcName: "cwise",
    blockSize: 64
  })

  var a = ndarray([1,2,3,4,5,6,7,8,9,10,11,12], [3,4])
  var b = ndarray([57,17,95,78,16,96,85,93,38,42,16,66,23,77,17,36,30,52,16,18,23,69,67,27], [2,3,4])
  var ref = ndarray([81,95,113,115,47,149,102,112,62,112,84,94], [3,4])

  c(a,b)

  t.ok(ops.equals(a, ref), "front block")

  // Test with block index at the back of the indices
  var c = compile({
    args: ["array", {blockIndices: -1}],
    pre: parse(function() {}),
    body: p,
    post: parse(function() {}),
    debug: false,
    funcName: "cwise",
    blockSize: 64
  })

  var a = ndarray([1,2,3,4,5,6,7,8,9,10,11,12], [3,4])
  var b = ndarray([57,17,95,78,16,96,85,93,38,42,16,66,23,77,17,36,30,52,16,18,23,69,67,27], [3,4,2])
  var ref = ndarray([75,174,113,179,81,83,101,54,83,35,93,95], [3,4])

  c(a,b)

  t.ok(ops.equals(a, ref), "back block")

  t.end()
})

