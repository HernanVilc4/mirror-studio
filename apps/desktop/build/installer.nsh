; Opens the firewall for Mirror Studio on every profile (lab networks are often "Public"), but only for LAN
; addresses (local subnet and private ranges), never the Internet. First it deletes EVERY rule for the program,
; including the BLOCK rules Windows creates when its "Security Alert" is cancelled: a block beats any allow.
; The app checks this again at every start and repairs it (one UAC prompt) if something changed: src/main/firewall.ts.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mirror Studio"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Mirror Studio" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=any remoteip=localsubnet,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'
!macroend
!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mirror Studio"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend
