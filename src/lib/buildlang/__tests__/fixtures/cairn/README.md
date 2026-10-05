# Cairn golden fixtures

Data files from the Cairn proof of concept, copied unchanged with the
maintainer's approval (SCHEM-119): the example programs
`examples/{cottage,manor,tower}.json` and Cairn's compiled outputs
`samples/{cottage,manor,tower}.schem` (Sponge v2, Minecraft 1.21.4). No Cairn
code is included.

`../../cairn-golden.test.ts` compiles each program for 1.21.4 and checks it
matches its `.schem` block for block and state for state, with blocks of one
`mix` treated as equal. Prettier skips this folder so the files stay
byte-for-byte as Cairn wrote them.
