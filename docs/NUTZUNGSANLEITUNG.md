# CipherSpace – Kurzanleitung

CipherSpace ist eine Anwendung für gemeinsame Notizen in Workspaces. Notizen werden im Browser verschlüsselt und erst bei einem manuellen Abgleich mit dem Server synchronisiert. Bereits auf dem Gerät gespeicherte Notizen lassen sich auch ohne Verbindung weiter bearbeiten.

## 1. Account erstellen

Öffne **Account erstellen**. Gib deine **E-Mail-Adresse** und ein **Passwort** mit 12 bis 128 Zeichen ein. Wähle anschließend **Account erstellen**. Danach öffnet CipherSpace die Seite **Workspaces**.

Das Account-Passwort meldet dich an und schützt außerdem deine lokale Verschlüsselungsidentität. Es ist nicht das Entsperrpasswort eines Workspace.

## 2. Verschlüsselung einrichten

Vor dem ersten Workspace erscheint **Dieses Gerät für Verschlüsselung einrichten**. Gib dein **Account-Passwort** ein und wähle **Verschlüsselungsidentität erstellen**.

CipherSpace erstellt dabei im Browser eine persönliche Verschlüsselungsidentität. Der private Teil bleibt geschützt in diesem Browserprofil gespeichert; nur der öffentliche Teil wird registriert. Sichere anschließend unter **Sicherheit** ein Wiederherstellungspaket. Ohne dieses Paket kann die Identität nach einem Verlust der Browserdaten nicht automatisch ersetzt werden.

Wenn für deinen Account bereits eine Identität registriert ist, der private Teil auf diesem Gerät aber fehlt, musst du das zugehörige Wiederherstellungspaket importieren.

## 3. Workspace erstellen

Gib auf der Seite **Workspaces** unter **Workspace erstellen** einen **Workspace-Namen** ein und wähle **Workspace erstellen**. Der Name ist für den Server und alle Mitglieder sichtbar.

Im neuen Workspace legst du danach unter **Verschlüsselte Synchronisation** ein **Lokales Entsperrpasswort** fest, bestätigst es und wählst **Schlüssel erstellen und entsperren**. Dieses Passwort schützt den Workspace-Schlüssel auf diesem Gerät. Es kann unabhängig vom Account-Passwort gewählt werden und lässt sich in der aktuellen Version nicht wiederherstellen.

## 4. Notizen erstellen und bearbeiten

Öffne im Workspace den Reiter **Notizen**. Solange der Workspace entsperrt ist, können Besitzer und Editoren Titel und Inhalt eingeben und **Notiz erstellen** wählen. Die Notiz wird zunächst verschlüsselt auf diesem Gerät gespeichert.

Öffne eine Notiz aus der Liste, ändere sie und wähle **Änderung speichern**. Auch diese Änderung bleibt zunächst lokal und wird als **Ausstehend** markiert. Nur Besitzer können eine Notiz über **Lokal löschen** zum Löschen vormerken. Leser können Notizen lesen, aber nicht ändern.

Kommentare stehen erst nach der ersten Synchronisation einer Notiz zur Verfügung. Sie benötigen immer eine Onlineverbindung und sind nicht Teil der Offline-Synchronisation.

## 5. Synchronisierung

Wähle im Kopf des Workspace **Synchronisieren**, um ausstehende Notizänderungen zu senden und Serveränderungen abzurufen. Die Synchronisierung läuft nicht automatisch im Hintergrund. Notiztitel und -inhalte werden im Browser verschlüsselt, bevor sie an den Server übertragen werden.

Ohne Verbindung kannst du bereits auf diesem Gerät gespeicherte Workspaces und Notizen öffnen und entsperrte Notizen weiter bearbeiten. Die Änderungen bleiben lokal vorgemerkt, bis du später wieder **Synchronisieren** wählst. Anmeldung, neue Workspaces, Mitgliederverwaltung und Kommentare benötigen den Server.

Wenn eine Notiz gleichzeitig an mehreren Stellen geändert wurde, zeigt CipherSpace einen **Konflikt**. Öffne **Konflikt lösen** und entscheide dich für die lokale Fassung, die Serverfassung oder eine manuell zusammengeführte Fassung. Die gewählte Lösung wird zunächst lokal gespeichert und muss anschließend synchronisiert werden.

## 6. Weitere Mitglieder hinzufügen

Nur Besitzer können auf der **Übersicht** eines entsperrten Workspace Mitglieder hinzufügen. Die andere Person braucht bereits einen CipherSpace-Account und eine eingerichtete Verschlüsselungsidentität.

Gib unter **Mitglied hinzufügen** die **E-Mail eines registrierten Accounts** ein, wähle **Editor** oder **Leser** und dann **Mitglied hinzufügen**. Dabei verschlüsselt dein Browser den Workspace-Schlüssel für die registrierte öffentliche Identität der anderen Person.

- **Besitzer** können Notizen lesen, erstellen, bearbeiten und löschen sowie Mitglieder hinzufügen.
- **Editoren** können Notizen lesen, erstellen und bearbeiten.
- **Leser** können Notizen und vorhandene Kommentare nur lesen.

Rollenänderungen und das Entfernen von Mitgliedern sind in der aktuellen Oberfläche nicht verfügbar. Eine Entfernung würde außerdem keine Schlüssel oder Daten löschen, die ein früheres Mitglied bereits erhalten hat.

## 7. Workspace entsperren

Nach einem Neuladen oder nachdem die Anwendung in den Hintergrund gewechselt ist, zeigt der Workspace den Status **gesperrt**. Gib dein **Lokales Entsperrpasswort** ein und wähle **Workspace entsperren**. Erst dann können Notizen entschlüsselt, bearbeitet und synchronisiert werden.

Als neu hinzugefügtes Mitglied siehst du stattdessen zunächst **Verschlüsselten Zugriff einrichten**. Gib dein **Account-Passwort** ein, wähle ein neues lokales Entsperrpasswort für diesen Workspace und bestätige es. Das Account-Passwort öffnet dabei deine persönliche Identität; das neue Entsperrpasswort schützt anschließend die lokale Kopie des Workspace-Schlüssels.

Fehlt eine Schlüsselfreigabe, muss ein Besitzer den Workspace entsperren und **Schlüssel teilen** wählen.

## 8. Wiederherstellung

Öffne in der Navigation **Sicherheit**. Für den Export brauchst du dein aktuelles **Account-Passwort** sowie eine eigene **Wiederherstellungspassphrase** mit 16 bis 128 Zeichen. Wähle **Wiederherstellungspaket erstellen** und lade das JSON über **JSON herunterladen** herunter oder kopiere den Text. Bewahre Paket und Passphrase getrennt auf.

Auf einem anderen Gerät meldest du dich zuerst beim passenden Account an. Füge unter **Auf diesem Gerät importieren** die JSON-Datei oder ihren Inhalt ein, gib Wiederherstellungspassphrase und aktuelles Account-Passwort ein und wähle **Wiederherstellungspaket importieren**.

Die drei Zugangsdaten haben unterschiedliche Aufgaben:

- Das **Account-Passwort** dient der Anmeldung und schützt die lokale Verschlüsselungsidentität.
- Das **Wiederherstellungspaket** enthält diese private Identität in verschlüsselter Form. Es enthält keine Notizen, Kommentare, Workspace-Schlüssel oder Passwörter.
- Die **Wiederherstellungspassphrase** entschlüsselt nur dieses Paket.

Nach dem Import kann CipherSpace vorhandene Workspace-Schlüsselfreigaben des Accounts wieder öffnen. Für jeden Workspace legst du dabei ein neues lokales Entsperrpasswort fest. Das Paket stellt keine lokalen Notizen oder noch nicht synchronisierten Änderungen wieder her.

## 9. Sperren und Abmelden

**Sperren** entfernt den entschlüsselten Workspace-Schlüssel aus dem Arbeitsspeicher. CipherSpace sperrt entsperrte Workspaces auch, wenn die Anwendung in den Hintergrund wechselt. Deine Serversitzung und die verschlüsselten lokalen Daten bleiben dabei erhalten.

**Abmelden** beendet zusätzlich die aktuelle Serversitzung. Lokal gespeicherte verschlüsselte Daten werden dadurch nicht vom Gerät gelöscht.

## 10. Hinweise zum Prototyp

CipherSpace befindet sich in aktiver Entwicklung und ist derzeit als Softwareprototyp gedacht. Die Synchronisierung erfolgt manuell, Kommentare sind nur online verfügbar und die Anwendung wurde nicht unabhängig sicherheitsgeprüft. Nicht synchronisierte lokale Daten gehen verloren, wenn die Browserdaten gelöscht werden oder das Gerät nicht mehr verfügbar ist.
