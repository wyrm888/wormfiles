; Undo WormFiles' Windows integration when it's uninstalled (not when it's just being updated),
; so folders open in File Explorer again and Worm leaves the browser list.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $0 HKCU "Software\Classes\Directory\shell" ""
    StrCmp $0 "openinwormfiles" 0 +2
      DeleteRegValue HKCU "Software\Classes\Directory\shell" ""
    DeleteRegKey HKCU "Software\Classes\Directory\shell\openinwormfiles"

    ReadRegStr $0 HKCU "Software\Classes\Drive\shell" ""
    StrCmp $0 "openinwormfiles" 0 +2
      DeleteRegValue HKCU "Software\Classes\Drive\shell" ""
    DeleteRegKey HKCU "Software\Classes\Drive\shell\openinwormfiles"

    ReadRegStr $0 HKCU "Software\Classes\CLSID\{52205fd8-5dfb-447d-801a-d0b52f2e83e1}\shell\opennewwindow\command" "CreatedBy"
    StrCmp $0 "WormFiles" 0 +2
      DeleteRegKey HKCU "Software\Classes\CLSID\{52205fd8-5dfb-447d-801a-d0b52f2e83e1}"

    DeleteRegKey HKCU "Software\Clients\StartMenuInternet\WormFiles"
    DeleteRegValue HKCU "Software\RegisteredApplications" "WormFiles"
    DeleteRegKey HKCU "Software\Classes\WormFilesURL"
    DeleteRegKey HKCU "Software\Classes\WormFilesHTML"
  ${endIf}
!macroend
