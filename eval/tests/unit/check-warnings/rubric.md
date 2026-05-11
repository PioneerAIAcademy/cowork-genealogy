# Check Warnings Rubric

## Dimensions

### Detection accuracy
Did the skill detect genuine impossibilities and anomalies (birth after death, marriage at age 5, 150-year lifespan) without flagging valid edge cases?

### Severity classification
Are warnings classified appropriately by severity? An impossibility (born after death) is critical. An anomaly (married at 16) is a note, not a warning.

### Actionability
Does each warning suggest what to investigate? "Birth year conflict between census and death certificate" is more useful than "possible date error."
