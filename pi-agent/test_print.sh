#!/bin/bash

echo "======================================="
echo "Canon LBP2900 Print Test Script"
echo "======================================="

# Check if printer exists
if ! lpstat -p LBP2900 &>/dev/null; then
    echo "❌ ERROR: Printer 'LBP2900' not found!"
    echo "Run: lpstat -p to see available printers"
    exit 1
fi

# Show printer status
echo ""
echo "📋 Printer Status:"
lpstat -p LBP2900

# Find test file
TEST_FILE="/home/karan/kagaz/storage/JOB20260211160418425/Permission_Letter_PES_Next_Incubation_Center_Final.pdf"

if [ ! -f "$TEST_FILE" ]; then
    echo "❌ ERROR: Test file not found at $TEST_FILE"
    exit 1
fi

echo ""
echo "📄 Test File: $TEST_FILE"
echo "📏 File Size: $(du -h "$TEST_FILE" | cut -f1)"

# Print the file
echo ""
echo "🖨️  Sending to printer..."
JOB_ID=$(lp -d LBP2900 "$TEST_FILE" 2>&1 | grep -oP 'request id is \K\S+')

if [ -n "$JOB_ID" ]; then
    echo "✅ Print job submitted: $JOB_ID"
    echo ""
    echo "📊 Job Status:"
    lpstat -o "$JOB_ID"
    echo ""
    echo "💡 Monitor the printer queue with: watch lpstat -o"
else
    echo "❌ ERROR: Failed to submit print job"
    exit 1
fi

echo ""
echo "======================================="
echo "Test complete! Check your printer."
echo "======================================="
