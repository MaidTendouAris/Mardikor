!define SHELLNEW_CLASSES "Software\Classes"
!define MARKDOWN_FILE_TYPE "Mardikor.Markdown.Document"
!define MARKDOWN_TYPE_NAME_STATE "Software\Mardikor\ShellNewMarkdownType"

!macro RegisterShellNew EXT METHOD DATA TITLE ICON
  ReadRegStr $0 HKCR ".${EXT}\ShellNew" "MardikorInstallDir"
  ClearErrors
  EnumRegValue $1 HKCR ".${EXT}\ShellNew" 0
  # Keep an existing New menu entry owned by another application.
  ${If} ${Errors}
  ${OrIf} $0 != ""
    WriteRegStr SHELL_CONTEXT "${SHELLNEW_CLASSES}\.${EXT}\ShellNew" "${METHOD}" "${DATA}"
    WriteRegExpandStr SHELL_CONTEXT "${SHELLNEW_CLASSES}\.${EXT}\ShellNew" "ItemName" "${TITLE}"
    WriteRegStr SHELL_CONTEXT "${SHELLNEW_CLASSES}\.${EXT}\ShellNew" "IconPath" "$INSTDIR\resources\icons\${ICON},0"
    WriteRegStr SHELL_CONTEXT "${SHELLNEW_CLASSES}\.${EXT}\ShellNew" "MardikorInstallDir" "$INSTDIR"
  ${EndIf}
!macroend

!macro RestoreMarkdownShellNewTypeName
  ReadRegStr $0 HKCU "${MARKDOWN_TYPE_NAME_STATE}" "ProgID"
  System::Call 'shlwapi::StrChrW(w r0, i 92) p .r3'
  ${If} $0 != ""
  ${AndIf} $3 == 0
    ReadRegStr $1 HKCU "${MARKDOWN_TYPE_NAME_STATE}" "Label"
    ReadRegStr $2 HKCU "${SHELLNEW_CLASSES}\$0" "FriendlyTypeName"
    ${If} $1 != ""
    ${AndIf} $1 == $2
      ReadRegDWORD $2 HKCU "${MARKDOWN_TYPE_NAME_STATE}" "HadEmptyName"
      ${If} $2 == 1
        WriteRegStr HKCU "${SHELLNEW_CLASSES}\$0" "FriendlyTypeName" ""
      ${Else}
        DeleteRegValue HKCU "${SHELLNEW_CLASSES}\$0" "FriendlyTypeName"
        DeleteRegKey /ifempty HKCU "${SHELLNEW_CLASSES}\$0"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  DeleteRegKey HKCU "${MARKDOWN_TYPE_NAME_STATE}"
!macroend

!macro EnsureMarkdownShellNewTypeName TITLE
  ReadRegStr $2 HKCR ".md\ShellNew" "MardikorInstallDir"
  ${If} $2 != ""
    ReadRegStr $0 HKCR ".md" ""
    ReadRegStr $1 HKCU "${MARKDOWN_TYPE_NAME_STATE}" "ProgID"
    ${If} $1 != ""
    ${AndIf} $1 != $0
      !insertmacro RestoreMarkdownShellNewTypeName
      ReadRegStr $0 HKCR ".md" ""
    ${EndIf}
    System::Call 'shlwapi::StrChrW(w r0, i 92) p .r3'
    ${If} $0 != ""
    ${AndIf} $3 == 0
      # Explorer uses the effective ProgID's description even with ShellNew
      # ItemName set. A user association can mask the installed named ProgID.
      ReadRegStr $1 HKCR "$0" ""
      ReadRegStr $2 HKCR "$0" "FriendlyTypeName"
      ${If} $1 == ""
      ${AndIf} $2 == ""
        StrCpy $3 0
        ClearErrors
        ReadRegStr $2 HKCU "${SHELLNEW_CLASSES}\$0" "FriendlyTypeName"
        ${IfNot} ${Errors}
          StrCpy $3 1
        ${EndIf}
        ClearErrors
        WriteRegStr HKCU "${SHELLNEW_CLASSES}\$0" "FriendlyTypeName" "${TITLE}"
        ${IfNot} ${Errors}
          WriteRegStr HKCU "${MARKDOWN_TYPE_NAME_STATE}" "ProgID" "$0"
          WriteRegStr HKCU "${MARKDOWN_TYPE_NAME_STATE}" "Label" "${TITLE}"
          WriteRegDWORD HKCU "${MARKDOWN_TYPE_NAME_STATE}" "HadEmptyName" $3
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro RemoveShellNew EXT METHOD DATA ICON
  ReadRegStr $0 SHELL_CONTEXT "${SHELLNEW_CLASSES}\.${EXT}\ShellNew" "MardikorInstallDir"
  ${If} $0 == $INSTDIR
    ReadRegStr $1 SHELL_CONTEXT "${SHELLNEW_CLASSES}\.${EXT}\ShellNew" "${METHOD}"
    ${If} $1 == "${DATA}"
      DeleteRegValue SHELL_CONTEXT "${SHELLNEW_CLASSES}\.${EXT}\ShellNew" "${METHOD}"
      DeleteRegValue SHELL_CONTEXT "${SHELLNEW_CLASSES}\.${EXT}\ShellNew" "ItemName"
    ${EndIf}
    ReadRegStr $1 SHELL_CONTEXT "${SHELLNEW_CLASSES}\.${EXT}\ShellNew" "IconPath"
    ${If} $1 == "$INSTDIR\resources\icons\${ICON},0"
      DeleteRegValue SHELL_CONTEXT "${SHELLNEW_CLASSES}\.${EXT}\ShellNew" "IconPath"
    ${EndIf}
    DeleteRegValue SHELL_CONTEXT "${SHELLNEW_CLASSES}\.${EXT}\ShellNew" "MardikorInstallDir"
    DeleteRegKey /ifempty SHELL_CONTEXT "${SHELLNEW_CLASSES}\.${EXT}\ShellNew"
  ${EndIf}
!macroend
