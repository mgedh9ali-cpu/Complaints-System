#define AppName "شعبة الاستفسارات والشكاوى"
#define AppVersion "0.4.0"
#define AppPublisher "شعبة الاستفسارات والشكاوى"

[Setup]
AppId={{B80E1B1E-8F77-4D89-9A4E-8AB3C9E8D241}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\ComplaintsSystem
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Shubat-Al-Shakawi-Setup
SetupIconFile=complaints.ico
UninstallDisplayIcon={app}\node.exe
ArchitecturesInstallIn64BitMode=x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
Uninstallable=yes

[Languages]
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"

[Tasks]
Name: "desktopicon"; Description: "إنشاء اختصار على سطح المكتب"; GroupDescription: "الاختصارات:"; Flags: checkedonce

[Dirs]
Name: "{app}\data"

[Files]
Source: "payload\node.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\start-installed-app.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\scripts\initialize-local-config.js"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\scripts\open-browser-new-window.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\scripts\backup-database.js"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\scripts\verify-audit-log.js"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\scripts\verify-database-restore.js"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\scripts\sign-program-update.js"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\app.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\index.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\styles.css"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\ui-enhancements.css"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\ui-enhancements.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\manifest.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\sw.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\lib\*.js"; DestDir: "{app}\lib"; Flags: ignoreversion
Source: "..\node_modules\*"; DestDir: "{app}\node_modules"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\start-installed-app.bat"; WorkingDir: "{app}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\start-installed-app.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[UninstallDelete]
Type: files; Name: "{app}\*.log"

[Code]
function InitializeSetup(): Boolean;
begin
  Result := IsWin64;
  if not Result then
    MsgBox('يتطلب هذا الإصدار نظام Windows 64-bit.', mbError, MB_OK);
end;
