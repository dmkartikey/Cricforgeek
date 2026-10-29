import os, time
os.environ["GETTY_DEBUG"] = "1"
src = open("qa/getty_lib.py").read().split("\ncon = duckdb.connect")[0]
src = src.replace("work, out, cache = sys.argv[1:4]", "work, out, cache = '.', 'out', 'out'").replace("import duckdb", "")
g = {}; exec(src, g)
for nm, team in (("Nicholas Pooran", "West Indies"),):
    e = g["find"](nm, team); print("RESULT", nm, e)
