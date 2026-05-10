@echo off
cd /d "c:\Users\OWNER\Desktop\Workspace\burgundy-bid\burgundy-bid"
pm2 resurrect
pm2 logs --lines 50
