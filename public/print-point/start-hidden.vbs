Option Explicit
Dim shell, files, root, runner, powershell, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
runner = files.BuildPath(root, "run.ps1")
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
If Not files.FileExists(runner) Or Not files.FileExists(powershell) Then WScript.Quit 2
' Preflight validates the script host without starting an agent or reading credentials.
If WScript.Arguments.Count = 1 Then
  If WScript.Arguments(0) = "/check" Then WScript.Quit 0
End If
If WScript.Arguments.Count <> 0 Then WScript.Quit 2
shell.CurrentDirectory = root
command = Chr(34) & powershell & Chr(34) & " -NoProfile -NonInteractive -WindowStyle Hidden -File " & Chr(34) & runner & Chr(34)
' GUI host has no operator console. Wait keeps Task Scheduler tracking the child.
On Error Resume Next
result = shell.Run(command, 0, True)
If Err.Number <> 0 Then WScript.Quit 1
On Error GoTo 0
WScript.Quit result
