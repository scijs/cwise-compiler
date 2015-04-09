"use strict"
var parse = require("cwise-parser")
var compile = require("../compiler.js")
var ndarray = require("ndarray")
var ops = require("ndarray-ops")

require("tape")("block tests", function(t) {
  var body2 = parse(function(a,b) {
      a = b[0]+b[1]+1
  })
  var body23 = parse(function(a,b) {
      a = b[0][0]*b[1][0]+b[0][1]*b[1][1]+b[0][2]*b[1][2]
  })

  // Test with block index at the front of the indices
  var c = compile({
    args: ["array", {blockIndices: 1}],
    pre: parse(function() {}),
    body: body2,
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
    body: body2,
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
  
  // Multiple block indices
  var c = compile({
    args: ["array", {blockIndices: -2}],
    pre: parse(function() {}),
    body: body23,
    post: parse(function() {}),
    debug: false,
    funcName: "cwise",
    blockSize: 64
  })
  var a = ndarray([1,2,3,4,5,6,7,8,9,10,11,12], [3,4])
  var b = ndarray([48,46,89,64,72,96,38,37,79,92,89,62,84,41,13,81,53,30,68,78,34,81,90,50,
                   82,97,46,18,11,79,15,68,88,58,71,84,76,35,74,82,27,47,59,25,78,61,10,43,
                   96,59,21,74,41,67,11,72,38,62,95,66,57,44,93,10,51,59,50,85,71,41,79,45], [3,4,2,3])
  var ref = ndarray([14928,11687,9367,14228,6177,13090,10655,7203,10930,10030,8301,11960], [3,4])

  c(a,b)

  t.ok(ops.equals(a, ref), "block with two indices")

  t.end()
})

