using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;

// Each invocation is executed on the main STA thread. Return plain values before releasing COM.
internal sealed class BoardCommands
{
    private readonly dynamic ns, inbox;
    private readonly string store, inboxId, separator;
    private static readonly string[] States = { "Offen", "In Bearbeitung", "Warten", "Erledigt" };
    private readonly string prefix;
    private static readonly StringComparer IgnoreCase = StringComparer.OrdinalIgnoreCase;

    public BoardCommands(object session, object defaultInbox, string separator, string configuredPrefix=null)
    {
        ns = session;
        inbox = defaultInbox;
        store = (string)inbox.StoreID;
        inboxId = (string)inbox.EntryID;
        this.separator = separator;
        prefix=string.IsNullOrWhiteSpace(configuredPrefix)?"Status: ":configuredPrefix;
        if (prefix.Contains(separator)) throw new ArgumentException("Das Statuspräfix darf das Outlook-Listentrennzeichen nicht enthalten.");
    }

    public object Execute(string[] args, Func<string,string[]> decodeTags)
    {
        switch (args[0]) {
        case "--inbox":
        case "--board":
        case "--folder":
            int start=args[0]=="--inbox" ? 1 : 2;
            if(args.Length!=start && args.Length!=start+3) break;
            int days=args.Length>start ? Range(args[start],0,36500) : 60;
            int done=args.Length>start ? Range(args[start+1],0,36500) : 14;
            int limit=args.Length>start ? Range(args[start+2],0,5000) : 500;
            if(args[0]=="--folder") return FolderCards(Folder(args[1]),false,days,done,limit);
            var board=new List<object>();
            var keys=new HashSet<string>(IgnoreCase){inboxId};
            if(args[0]=="--board") {
                foreach(string id in decodeTags(args[1])) keys.Add(id);
                keys.Add((string)ns.GetDefaultFolder(5).EntryID);
            }
            foreach(string id in keys) board.AddRange(BoardRows(Folder(id),days,done,limit));
            return board;
        case "--backlog":
            // Älteste zuerst, ohne Erledigte: die ältesten 300 (Posteingang aufräumen).
            if(args.Length==1) return FolderCards(inbox,true,0,0,300);
            break;
        case "--backlog-page":
            // Seitenweise für die Einrichtung (E7): Grenze und optional der Fortsetzungspunkt der vorigen Seite.
            if(args.Length==2 || args.Length==3) return BacklogPage(Range(args[1],1,5000),args.Length==3 ? args[2] : null);
            break;
        case "--training":
            if(args.Length==4) return Training(Folder(args[1]),Range(args[2],0,5000),Range(args[3],0,36500));
            break;
        case "--correspondence":
            if(args.Length>=2) return Correspondence(Range(args[1],1,36500),args.Skip(2));
            break;
        case "--folders":
            if (args.Length == 1) {
                var result = new List<object>();
                ChildFolders(inbox.Parent, "", null, 1, result);
                return result;
            }
            break;
        case "--folder-counts":
            // Anzahl der Elemente je Ordner, nur für die Stellen, die sie brauchen (Einrichtung E1/E4, Zusammenlegen).
            // Ohne Liste alle Ordner wie bei --folders, sonst nur die genannten Ordner-IDs (JSON-Liste).
            if (args.Length == 1 || args.Length == 2) return FolderCounts(args.Length == 2 ? decodeTags(args[1]) : null);
            break;
        case "--categories":
            if(args.Length==1) return MasterCategories();
            break;
        case "--sync-colors":
            if(args.Length==5) {
                int[] colors=args.Skip(1).Select(s=>Range(s,0,25)).ToArray();
                for(int i=0;i<States.Length;i++) EnsureCategory(prefix+States[i],colors[i],true);
                return MasterCategories();
            }
            break;
        case "--open":
            if (args.Length == 2 || args.Length == 3) {
                Mail(args[1], args.Length == 2 ? inboxId : args[2]).Display(false);
                return null;
            }
            break;
        case "--draft":
            if (args.Length == 5) { Draft(args[1],args[2],args[3],args[4]); return null; }
            break;
        case "--folder-create":
            if (args.Length == 3) return CreateFolder(args[1],args[2]);
            break;
        case "--folder-rename":
            if (args.Length == 3) return RenameFolder(args[1],args[2]);
            break;
        case "--folder-move":
            if (args.Length == 4) return MoveFolder(args[1],args[2],args[3]);
            break;
        case "--move":
        case "--undo":
            if (args.Length == 4) return Move(args[1], args[2], args[3]);
            break;
        case "--status":
            if (args.Length >= 4 && args.Length <= 7)
                return SetStatus(args[1],args[2],args[3],args.Length>4?args[4]:null,
                    args.Length>5?args[5]:null,args.Length>6?args[6]:null);
            break;
        case "--field":
            if (args.Length == 5 || args.Length == 6)
                return SetField(args[1], args[2], args[3], args[4], args.Length==6?args[5]:null);
            break;
        case "--tags":
            if (args.Length == 5) return SetTags(args[1], args[2], decodeTags(args[3]), decodeTags(args[4]));
            break;
        }
        throw new ArgumentException("Unbekannter oder unvollständiger Outlook-Aufruf.");
    }

    private static bool Same(string a, string b) { return IgnoreCase.Equals(a,b); }

    private dynamic Folder(string id)
    {
        dynamic folder = ns.GetFolderFromID(id, store);
        if (!Same((string)folder.StoreID, store) || (int)folder.DefaultItemType != 0)
            throw new InvalidOperationException("Bitte einen E-Mail-Ordner im Standardpostfach wählen.");
        return folder;
    }

    private void ChildFolders(dynamic parent, string absolute, string relative, int depth, List<object> result)
    {
        foreach (dynamic sub in parent.Folders) {
            try {
                if ((int)sub.DefaultItemType != 0 || !Same((string)sub.StoreID,store)) continue;
                string id = sub.EntryID, name = sub.Name;
                string full = absolute + "/" + name;
                bool isInbox = Same(id, inboxId);
                string key = isInbox ? "" : relative == null ? full :
                    (relative.Length == 0 ? name : relative + "/" + name);
                int omitted = depth < 8 ? 0 : HiddenMailFolders(sub);
                result.Add(new { id, name, path = key, isInbox,
                    parentId = (string)parent.EntryID, rootId = (string)inbox.Parent.EntryID, omitted });
                if (depth < 8) ChildFolders(sub, full, isInbox || relative != null ? key : null, depth+1, result);
            } catch (COMException ex) {
                // A delegated folder may be visible in the tree without read access.
                if (ex.ErrorCode != unchecked((int)0x80070005)) throw;
            }
        }
    }

    // Mail folders below the walk limit. The listed folder itself is not included.
    private int HiddenMailFolders(dynamic folder)
    {
        int hidden = 0;
        foreach (dynamic sub in folder.Folders) {
            try {
                if ((int)sub.DefaultItemType != 0 || !Same((string)sub.StoreID, store)) continue;
                hidden += 1 + HiddenMailFolders(sub);
            } catch (COMException ex) {
                if (ex.ErrorCode != unchecked((int)0x80070005)) throw;
            }
        }
        return hidden;
    }

    // Number of items in the folder for the setup (E1, E4). Null if Outlook cannot count it.
    private static int? ItemCount(object folder)
    {
        try { return (int)((dynamic)folder).Items.Count; }
        catch (COMException) { return null; }
    }

    // Zahlen je Ordner-ID. Ohne Liste alle Mail-Ordner des Standardpostfachs. Unbekannte oder nicht lesbare Ordner fehlen in der Antwort.
    private List<object> FolderCounts(string[] ids)
    {
        var result = new List<object>();
        if (ids == null) {
            var all = new List<object>();
            ChildFolders(inbox.Parent, "", null, 1, all);
            ids = all.Select(f => (string)((dynamic)f).id).ToArray();
        }
        foreach (string id in ids.Distinct(IgnoreCase)) {
            dynamic folder;
            try { folder = Folder(id); }
            catch (Exception ex) {
                if (ex is InvalidOperationException || IsItemReadError(ex) ||
                    (ex is COMException && ((COMException)ex).ErrorCode == unchecked((int)0x8004010F))) continue;
                throw;
            }
            result.Add(new { id = (string)folder.EntryID, count = ItemCount((object)folder) });
        }
        return result;
    }

    private dynamic Mail(string id, string expected)
    {
        dynamic mail = ns.GetItemFromID(id, store);
        if ((int)mail.Class != 43 || !Same((string)mail.Parent.EntryID, expected) ||
            !Same((string)mail.Parent.StoreID, store))
            throw new InvalidOperationException("Die Mail befindet sich inzwischen in einem anderen Ordner. Bitte aktualisieren.");
        return mail;
    }

    private void Draft(string id,string folderId,string mode,string text)
    {
        dynamic mail=Mail(id,folderId);
        dynamic draft;
        switch(mode) {
        case "reply": draft=mail.Reply(); break;
        case "reply-all":
        case "follow-up": draft=mail.ReplyAll(); break;
        case "forward": draft=mail.Forward(); break;
        default: throw new ArgumentException("Unbekannte Entwurfsart.");
        }
        if (!string.IsNullOrEmpty(text)) {
            switch ((int)draft.BodyFormat) {
            case 1: draft.Body=text+"\r\n\r\n"+(string)draft.Body; break;
            case 2:
                string html=(string)draft.HTMLBody ?? "";
                var body=System.Text.RegularExpressions.Regex.Match(html,@"<body\b[^>]*>",System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                if (!body.Success) throw new InvalidOperationException("Der HTML-Entwurf konnte nicht befüllt werden.");
                string paragraphs=string.Concat(text.Replace("\r\n","\n").Split('\n').Select(line =>
                    "<p>"+(line.Length>0 ? System.Net.WebUtility.HtmlEncode(line) : "&nbsp;")+"</p>"));
                draft.HTMLBody=html.Insert(body.Index+body.Length,paragraphs);
                break;
            default: throw new InvalidOperationException("Outlook kann diesen Entwurfstyp nicht mit Text befüllen.");
            }
        }
        draft.Display(false);
    }

    private dynamic ProjectParent(string id)
    {
        return Same((string)inbox.Parent.EntryID,id) ? inbox.Parent : Folder(id);
    }

    private string FolderPath(dynamic folder)
    {
        var parts=new Stack<string>();
        string rootId=inbox.Parent.EntryID;
        while (!Same((string)folder.EntryID,rootId) && !Same((string)folder.EntryID,inboxId)) {
            parts.Push((string)folder.Name);
            folder=folder.Parent;
        }
        return (Same((string)folder.EntryID,inboxId) ? "" : "/") + string.Join("/",parts);
    }

    private object FolderReceipt(dynamic folder,string previousName,string previousParent)
    {
        return new { id=(string)folder.EntryID, name=(string)folder.Name, path=(string)FolderPath(folder),
            parentId=(string)folder.Parent.EntryID, previousName, previousParentId=previousParent };
    }

    private static string CheckedName(string name)
    {
        name=name.Trim();
        if (name.Length==0 || name.Length>80 || name.IndexOfAny(new[]{'/','\\'})>=0 || name.Any(char.IsControl))
            throw new ArgumentException("Bitte einen Ordnernamen mit 1 bis 80 Zeichen ohne Schrägstriche eingeben.");
        return name;
    }

    private void GuardProject(dynamic folder)
    {
        if (Same((string)folder.EntryID,(string)inbox.Parent.EntryID)) throw new InvalidOperationException("Der Postfachstamm ist geschützt.");
        // Outlook protects additional service folders itself. Never rename or move standard mail folders.
        int[] standardMailFolders={3,4,5,6,16,23};
        foreach(int kind in standardMailFolders) {
            dynamic systemFolder=null;
            try { systemFolder=ns.GetDefaultFolder(kind); }
            catch(COMException ex) { if(ex.ErrorCode!=unchecked((int)0x8004010f)) throw; }
            if(systemFolder!=null && Same((string)systemFolder.EntryID,(string)folder.EntryID))
                throw new InvalidOperationException("Outlook-Standardordner sind geschützt.");
        }
    }

    private object CreateFolder(string parentId,string input)
    {
        string name=CheckedName(input);
        dynamic parent=ProjectParent(parentId);
        foreach(dynamic child in parent.Folders) {
            if(Same((string)child.Name,name)) throw new InvalidOperationException("Unter diesem Namen gibt es bereits einen Ordner.");
        }
        return FolderReceipt(parent.Folders.Add(name,6),null,null);
    }

    private object RenameFolder(string id,string input)
    {
        string name=CheckedName(input);
        dynamic folder=Folder(id);
        GuardProject(folder);
        string original=folder.Name, parent=folder.Parent.EntryID;
        folder.Name=name;
        return FolderReceipt(folder,original,parent);
    }

    private object MoveFolder(string id,string expectedParent,string newParent)
    {
        dynamic folder=Folder(id);
        GuardProject(folder);
        if (!Same((string)folder.Parent.EntryID,expectedParent)) throw new InvalidOperationException("Der Projektordner wurde inzwischen verschoben.");
        if (Same(expectedParent,newParent)) throw new InvalidOperationException("Der Ordner liegt bereits im Ziel.");
        dynamic destination=ProjectParent(newParent);
        dynamic ancestor=destination;
        string rootId=inbox.Parent.EntryID, name=folder.Name;
        while (!Same((string)ancestor.EntryID,rootId)) {
            if (Same((string)ancestor.EntryID,id)) throw new InvalidOperationException("Ein Ordner kann nicht in sich selbst verschoben werden.");
            ancestor=ancestor.Parent;
        }
        foreach(dynamic child in destination.Folders) {
            if (Same((string)child.Name,name)) throw new InvalidOperationException("Im Ziel existiert bereits ein gleichnamiger Ordner.");
        }
        // Outlook Folder.MoveTo does not return the moved folder. Resolve in its new parent after success.
        folder.MoveTo(destination);
        dynamic moved=destination.Folders.Item(name);
        return FolderReceipt(moved,name,expectedParent);
    }

    private object Move(string id, string source, string target)
    {
        if (Same(source,target)) throw new InvalidOperationException("Die Mail liegt schon im Zielordner.");
        dynamic destination = Folder(target);
        dynamic mail = Mail(id,source);
        dynamic moved = mail.Move(destination);
        return new { id = (string)moved.EntryID, source, target };
    }

    private string[] Categories(string raw)
    {
        return (raw ?? "").Split(new[]{separator},StringSplitOptions.RemoveEmptyEntries)
            .Select(s=>s.Trim()).Where(s=>s.Length>0).ToArray();
    }
    private bool IsStatus(string name) { return name.StartsWith(prefix,StringComparison.OrdinalIgnoreCase); }
    private string StatusOf(string[] cats)
    {
        foreach (string cat in cats) {
            string status = Array.Find(States,s=>Same(prefix+s,cat));
            if (status!=null) return status;
        }
        return "";
    }

    private object SetStatus(string id, string folderId, string status,string restoreSince,string expected,string expectedSince)
    {
        if (status!="" && !States.Contains(status)) throw new ArgumentException("Unbekannter Status.");
        dynamic item = Mail(id,folderId);
        string[] all = Categories((string)item.Categories);
        string previous = StatusOf(all);
        object oldTime=ReadProperty(item,"KanbanStatusSeit");
        string previousSince=oldTime is DateTime ? Iso((DateTime)oldTime) : "";
        if(expected!=null && (expected!=previous || (expectedSince!=null && !SameTimestamp(previousSince,expectedSince))))
            return new { conflict=true };
        string statusSince=previousSince;
        object newTime=null;
        if(status!="" && restoreSince!="") {
            DateTime when;
            if(restoreSince==null) {
                DateTime now=DateTime.Now;
                when=now.AddTicks(-(now.Ticks%TimeSpan.TicksPerSecond));
            }
            else if(!DateTime.TryParse(restoreSince,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out when))
                throw new ArgumentException("Ungültiges Statusdatum.");
            newTime=when;
        }
        if (previous!=status || (restoreSince!=null && restoreSince!=previousSince)) {
            var keep = all.Where(s=>!IsStatus(s)).ToList();
            if (status!="") keep.Insert(0,prefix+status);
            item.Categories = string.Join(separator+" ",keep);
            WriteProperty(item,"KanbanStatusSeit",5,newTime);
            item.Save();
            object savedTime=ReadProperty(item,"KanbanStatusSeit");
            statusSince=savedTime is DateTime ? Iso((DateTime)savedTime) : "";
            if(status!="") AddMissingCategory(prefix+status,new[]{8,2,4,5}[Array.IndexOf(States,status)]);
        }
        return new { id, status, previous, previousSince, statusSince };
    }

    private static bool SameTimestamp(string left,string right)
    {
        if(left==right) return true;
        DateTimeOffset a,b;
        return DateTimeOffset.TryParse(left,CultureInfo.InvariantCulture,DateTimeStyles.None,out a) &&
            DateTimeOffset.TryParse(right,CultureInfo.InvariantCulture,DateTimeStyles.None,out b) && a==b;
    }

    private object MasterCategories()
    {
        var result=new List<object>();
        foreach(dynamic cat in ns.Categories) result.Add(new {name=(string)cat.Name,color=(int)cat.Color});
        return result;
    }

    private void EnsureCategory(string name,int color,bool updateColor)
    {
        foreach(dynamic cat in ns.Categories) {
            if(!Same((string)cat.Name,name)) continue;
            if(updateColor && (int)cat.Color!=color) cat.Color=color;
            return;
        }
        ns.Categories.Add(name,color);
    }

    private void AddMissingCategory(string name,int color)
    {
        // Shared/delegated stores can allow editing a mail while forbidding category administration.
        // The mail category remains usable without an entry in the master list.
        try { EnsureCategory(name,color,false); }
        catch(COMException) { }
    }

    private object SetTags(string id,string folderId,string[] previousTags,string[] wanted)
    {
        if (previousTags==null || wanted==null || previousTags.Concat(wanted).Any(s=>string.IsNullOrWhiteSpace(s) ||
            s.Contains(separator) || IsStatus(s))) throw new ArgumentException("Ungültige Kategorie.");
        dynamic item=Mail(id,folderId);
        string[] all=Categories((string)item.Categories);
        var previous=all.Where(s=>!IsStatus(s)).ToArray();
        var removed=new HashSet<string>(previousTags.Except(wanted,IgnoreCase),IgnoreCase);
        var keep=all.Where(s=>!removed.Contains(s)).ToList();
        foreach (string added in wanted.Except(previousTags,IgnoreCase)) {
            if (!keep.Contains(added,IgnoreCase)) keep.Add(added);
        }
        if (!keep.SequenceEqual(all)) {
            item.Categories=string.Join(separator+" ",keep); item.Save();
            foreach(string name in wanted.Except(previousTags,IgnoreCase)) AddMissingCategory(name,0);
        }
        return new { id, tags=keep.Where(s=>!IsStatus(s)).ToArray(), previous };
    }

    private static object ReadProperty(dynamic item,string name)
    {
        dynamic prop=item.UserProperties.Find(name);
        return prop==null ? null : (object)prop.Value;
    }

    private static void WriteProperty(dynamic item,string name,int type,object value)
    {
        dynamic prop=item.UserProperties.Find(name);
        if (value==null) { if (prop!=null) prop.Delete(); return; }
        if (prop==null) prop=item.UserProperties.Add(name,type,false);
        prop.Value=value;
    }

    private static string DateText(object when)
    {
        return when is DateTime ? ((DateTime)when).ToString("yyyy-MM-dd",CultureInfo.InvariantCulture) : "";
    }

    private object SetField(string id,string folderId,string field,string value,string expected)
    {
        string name;
        switch(field) {
        case "followUp": name="KanbanNachfassen"; break;
        case "snoozeUntil": name="KanbanWiedervorlage"; break;
        case "note": name="KanbanNotiz"; break;
        default: throw new ArgumentException("Unbekanntes Mailfeld.");
        }
        object write=null;
        if (field=="note" && value.Length>500) throw new ArgumentException("Notizen dürfen höchstens 500 Zeichen lang sein.");
        if (value.Length>0) write=field=="note" ? (object)value : DateTime.ParseExact(value,"yyyy-MM-dd",CultureInfo.InvariantCulture);
        dynamic mail=Mail(id,folderId);
        object before=ReadProperty(mail,name);
        string previous=field=="note" ? Convert.ToString(before) : DateText(before);
        if(expected!=null && expected!=previous) return new { conflict=true };
        if (value!=previous) {
            WriteProperty(mail,name,field=="note"?1:5,write);
            mail.Save();
        }
        return new { id,field,value,previous };
    }

    // Only failures attributable to the current item may be ignored while reading cards.
    // Unknown provider errors, RPC rejection/disconnection and MAPI session failures propagate.
    private static bool IsItemReadError(Exception error)
    {
        if(error is UnauthorizedAccessException || error is InvalidCastException || error is FormatException ||
            error is Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) return true;
        COMException com=error as COMException;
        if(com==null) return false;
        switch(unchecked((uint)com.ErrorCode)) {
        case 0x80004005: // E_FAIL (e.g. unreadable property on an otherwise accessible item)
        case 0x80070005: // E_ACCESSDENIED
        case 0x80030005: // STG_E_ACCESSDENIED
        case 0x80040102: // MAPI_E_NO_SUPPORT
        case 0x80040107: // MAPI_E_INVALID_ENTRYID
        case 0x80040108: // MAPI_E_INVALID_OBJECT
        case 0x80040109: // MAPI_E_OBJECT_CHANGED
        case 0x8004010F: // MAPI_E_NOT_FOUND
        case 0x8004011B: // MAPI_E_CORRUPT_DATA
        case 0x80020003: // DISP_E_MEMBERNOTFOUND
        case 0x80020005: // DISP_E_TYPEMISMATCH
        case 0x80020009: // DISP_E_EXCEPTION
            return true;
        default: return false;
        }
    }

    private static string BodyPreview(dynamic mail)
    {
        string kind=(string)mail.MessageClass ?? "";
        if (kind.StartsWith("IPM.Note.SMIME",StringComparison.OrdinalIgnoreCase) &&
            kind.IndexOf("MultipartSigned",StringComparison.OrdinalIgnoreCase)<0) return "";
        try {
            string body=(string)mail.Body ?? "";
            return body.Substring(0,Math.Min(body.Length,1500));
        } catch (COMException ex) { if(!IsItemReadError(ex)) throw; return ""; }
    }

    private static string SenderAddress(dynamic mail)
    {
        try {
            string address=((string)mail.SenderEmailAddress ?? "").Trim();
            if (!address.StartsWith("/",StringComparison.Ordinal)) return address;
            dynamic sender = mail.Sender;
            if (sender==null) return "";
            dynamic user = sender.GetExchangeUser();
            return user==null ? "" : ((string)user.PrimarySmtpAddress ?? "").Trim();
        } catch (COMException ex) { if(!IsItemReadError(ex)) throw; return ""; }
    }

    private static int Range(string text,int min,int max)
    {
        int value;
        if(!int.TryParse(text,out value) || value<min || value>max) throw new ArgumentOutOfRangeException("Grenzwert",text,"Ungültiger Grenzwert.");
        return value;
    }

    private static string Iso(DateTime value)
    {
        return DateTime.SpecifyKind(value,DateTimeKind.Local).ToString("o",CultureInfo.InvariantCulture);
    }

    private static IEnumerable<dynamic> Walk(dynamic items,int count)
    {
        if(count<=0) yield break;
        dynamic mail=items.GetFirst();
        for(int i=0; i<count && mail!=null; i++) {
            yield return mail;
            if(i+1<count) mail=items.GetNext();
        }
    }

    private HashSet<string> ownAddresses;
    private bool IsOwn(string address)
    {
        if (string.IsNullOrEmpty(address)) return false;
        if(ownAddresses==null) {
            ownAddresses=new HashSet<string>(IgnoreCase);
            try { foreach(dynamic account in ns.Accounts) ownAddresses.Add(((string)account.SmtpAddress ?? "").Trim()); }
            catch (COMException ex) { if(!IsItemReadError(ex)) throw; }
            try { ownAddresses.Add(((string)ns.CurrentUser.Address ?? "").Trim()); }
            catch (COMException ex) { if(!IsItemReadError(ex)) throw; }
        }
        return ownAddresses.Contains(address);
    }

    private static string[] RecipientAddresses(dynamic mail)
    {
        var values=new List<string>();
        try {
            dynamic recipients=mail.Recipients;
            for(int i=1; i<=Math.Min((int)recipients.Count,20); i++) {
                dynamic recipient=recipients.Item(i);
                string address=(string)recipient.Address ?? "";
                if(address.StartsWith("/",StringComparison.Ordinal)) {
                    dynamic user=recipient.AddressEntry.GetExchangeUser();
                    if(user!=null) address=(string)user.PrimarySmtpAddress ?? address;
                }
                if(address.Length>0) values.Add(address);
            }
        } catch (COMException ex) { if(!IsItemReadError(ex)) throw; }
        return values.ToArray();
    }

    private object Correspondence(int days,IEnumerable<string> projects)
    {
        DateTime cutoff=DateTime.Now.AddDays(-days);
        dynamic sentFolder=ns.GetDefaultFolder(5);
        string sentId=sentFolder.EntryID;
        var sent=new List<object>();
        var incoming=new List<object>();
        var keys=new HashSet<string>(projects,IgnoreCase){inboxId,sentId};
        foreach(string id in keys) {
            bool sentRows=Same(id,sentId);
            dynamic folder=Folder(id), items=folder.Items;
            items.Sort(sentRows?"[SentOn]":"[ReceivedTime]",true);
            foreach(dynamic item in Walk(items,2000)) {
                if((int)item.Class!=43) continue;
                DateTime when=sentRows ? (DateTime)item.SentOn : (DateTime)item.ReceivedTime;
                if(when<cutoff) break;
                string senderEmail=SenderAddress(item);
                if(!sentRows && IsOwn(senderEmail)) continue;
                string status=StatusOf(Categories((string)item.Categories));
                object stamp=ReadProperty(item,"KanbanStatusSeit");
                var summary=new { id=(string)item.EntryID, folderId=id, folder=(string)folder.Name, storeId=store,
                    subject=(string)item.Subject ?? "", sender=(string)item.SenderName ?? "", senderEmail,
                    recipients=sentRows ? ((string)item.To ?? "") : "",
                    recipientEmails=sentRows ? (string[])RecipientAddresses(item) : new string[0],
                    isSent=sentRows, received=Iso(when), conversationId=(string)item.ConversationID ?? "",
                    status=status==""?"Offen":status,hasStatus=status!="",
                    statusSince=stamp is DateTime?Iso((DateTime)stamp):"" };
                (sentRows?sent:incoming).Add(summary);
            }
        }
        return new {sent,incoming};
    }

    private object Training(dynamic folder,int limit,int days)
    {
        var rows=new List<object>();
        dynamic items=folder.Items;
        items.Sort("[ReceivedTime]",true);
        DateTime cutoff=DateTime.Now.AddDays(-days);
        foreach(dynamic mail in Walk(items,limit*3)) {
            if ((int)mail.Class!=43) continue;
            if(days>0 && (DateTime)mail.ReceivedTime<cutoff) break;
            string[] all=Categories((string)mail.Categories);
            rows.Add(new { id=(string)mail.EntryID, conversationId=(string)mail.ConversationID ?? "", received=Iso((DateTime)mail.ReceivedTime),
                folderId=(string)folder.EntryID,subject=(string)mail.Subject ?? "",sender=(string)mail.SenderName ?? "",
                senderEmail=(string)SenderAddress(mail),body=(string)BodyPreview(mail),
                tags=all.Where(s=>!IsStatus(s)).ToArray(),attachments=(string[])Files(mail) });
            if(rows.Count>=limit) break;
        }
        return rows;
    }

    private static string[] Files(dynamic mail)
    {
        var names=new List<string>();
        try {
            dynamic entries=mail.Attachments;
            for(int i=1;i<=(int)entries.Count;i++) names.Add((string)entries.Item(i).FileName);
        } catch(COMException ex) { if(!IsItemReadError(ex)) throw; }
        return names.ToArray();
    }

    private string sentIdCache;
    private bool IsSentFolder(string id)
    {
        if (sentIdCache==null) sentIdCache=(string)ns.GetDefaultFolder(5).EntryID;
        return Same(sentIdCache,id);
    }

    private object Card(dynamic mail, dynamic folder, string[] all, string status)
    {
        string folderId=folder.EntryID;
        string senderEmail=SenderAddress(mail);
        object since=ReadProperty(mail,"KanbanStatusSeit");
        bool isSent=IsSentFolder(folderId) || IsOwn(senderEmail);
        return new { id=(string)mail.EntryID, storeId=store, folderId, folder=(string)folder.Name,
            subject=(string)mail.Subject ?? "(ohne Betreff)", sender=(string)mail.SenderName ?? "", senderEmail,
            received=Iso((DateTime)mail.ReceivedTime), conversationId=(string)mail.ConversationID ?? "",
            body=(string)BodyPreview(mail), status=status==""?"Offen":status, hasStatus=status!="",
            tags=all.Where(s=>!IsStatus(s)).ToArray(), attachments=(string[])Files(mail), isSent,
            recipients=isSent ? ((string)mail.To ?? "") : "", recipientEmails=isSent ? (string[])RecipientAddresses(mail) : new string[0],
            statusSince=since is DateTime ? Iso((DateTime)since):"", followUp=(string)DateText(ReadProperty(mail,"KanbanNachfassen")),
            snoozeUntil=(string)DateText(ReadProperty(mail,"KanbanWiedervorlage")),note=(string)ReadProperty(mail,"KanbanNotiz") ?? "" };
    }

    private IEnumerable<object> SafeCards(object folder, object collection, int scan, DateTime? cutoff,
        int doneDays, bool requireStatus, bool backlog, HashSet<string> seen=null)
    {
        foreach(dynamic mail in Walk(collection,scan)) {
            object card;
            try {
                if((int)mail.Class!=43) continue;
                if(cutoff.HasValue && (DateTime)mail.ReceivedTime<cutoff.Value) break;
                string[] all=Categories((string)mail.Categories);
                string status=StatusOf(all);
                if(requireStatus && status=="") continue;
                if(status=="Erledigt" && (backlog || DoneExpired(mail,doneDays))) continue;
                string id=(string)mail.EntryID;
                if(seen!=null && seen.Contains(id)) continue;
                card=Card(mail,folder,all,status);
                if(seen!=null) seen.Add(id);
            } catch(Exception ex) {
                if(!IsItemReadError(ex)) throw;
                continue;
            }
            yield return card;
        }
    }

    private List<object> FolderCards(dynamic folder,bool backlog,int days,int doneDays,int limit)
    {
        dynamic items=folder.Items;
        items.Sort("[ReceivedTime]",!backlog);
        DateTime? cutoff=days>0 ? (DateTime?)DateTime.Now.AddDays(-days) : null;
        return SafeCards((object)folder,(object)items,limit*4,cutoff,doneDays,false,backlog).Take(limit).ToList();
    }

    // Fortsetzungspunkt einer Rückstandsseite: Empfangszeit (Ticks) und EntryID der zuletzt geprüften Mail.
    private static string BacklogCursor(DateTime when,string id) { return when.Ticks.ToString(CultureInfo.InvariantCulture)+"|"+id; }

    // Eine Seite des Rückstands, älteste zuerst: höchstens `limit` Karten ohne Erledigte, nach dem Fortsetzungspunkt `cursor`.
    // Die Reihenfolge ist fest: Empfangszeit, bei gleicher Zeit EntryID (ordinal). Outlook sortiert gleich alte Mails nicht verlässlich,
    // deshalb sortiert die Seite jede Gruppe gleich alter Mails selbst. Erledigt ist alles vor dem Fortsetzungspunkt (t, id): früher als t
    // oder gleich alt mit EntryID ≤ id. Eine verschobene Fortsetzungsmail stört damit nicht.
    // Statt die vorigen Seiten erneut zu lesen, springt die Seite über eine Einschränkung auf die Empfangszeit (minutengenau, eine Minute
    // Puffer). Die Einschränkung ist nur eine Abkürzung: Scheitert sie oder beginnt ihr Ergebnis erst nach dem Fortsetzungspunkt (Datum
    // anders verstanden), liest die Seite ohne sie. Je Seite prüft sie höchstens `limit*4` Mails nach dem Fortsetzungspunkt; Erledigte und
    // Unlesbare zählen mit. `next` zeigt auf die zuletzt geprüfte Mail und ist nur am Ende des Posteingangs null, eine kurze oder leere
    // Seite heißt also nicht, dass nichts mehr kommt.
    private object BacklogPage(int limit,string cursor)
    {
        DateTime? after=null;
        string afterId=null;
        if(cursor!=null) {
            int bar=cursor.IndexOf('|');
            long ticks;
            if(bar<1 || bar==cursor.Length-1 || !long.TryParse(cursor.Substring(0,bar),NumberStyles.None,CultureInfo.InvariantCulture,out ticks) ||
                ticks>DateTime.MaxValue.Ticks)
                throw new ArgumentException("Ungültiger Fortsetzungspunkt.");
            after=new DateTime(ticks);
            afterId=cursor.Substring(bar+1);
        }
        if(after.HasValue) {
            dynamic restricted=null;
            try { restricted=((dynamic)inbox.Items).Restrict("[ReceivedTime] >= '"+after.Value.AddMinutes(-1).ToString("g",CultureInfo.CurrentCulture)+"'"); }
            catch(COMException) { }
            catch(Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) { }
            if(restricted!=null) {
                object page=BacklogWalk(restricted,limit,after,afterId,true);
                if(page!=null) return page;
            }
        }
        return BacklogWalk(inbox.Items,limit,after,afterId,false);
    }

    // Liefert null, wenn `restricted` die Mails am Fortsetzungspunkt nicht enthält (dann ohne Einschränkung neu).
    private object BacklogWalk(dynamic items,int limit,DateTime? after,string afterId,bool restricted)
    {
        items.Sort("[ReceivedTime]",false);
        var cards=new List<object>();
        var group=new List<KeyValuePair<string,object>>();
        DateTime groupTime=DateTime.MinValue;
        int scanned=0, budget=limit*4;
        string next=null;
        bool first=true, stopped=false;
        // Eine Gruppe gleich alter Mails nach EntryID abarbeiten. Liefert true, sobald die Seite voll ist.
        Func<bool> flush=()=>{
            foreach(var entry in group.OrderBy(e=>e.Key,StringComparer.Ordinal)) {
                if(after.HasValue && (groupTime<after.Value || (groupTime==after.Value && string.CompareOrdinal(entry.Key,afterId)<=0))) continue;
                scanned++;
                next=BacklogCursor(groupTime,entry.Key);
                object card=BacklogCard((dynamic)entry.Value);
                if(card!=null) cards.Add(card);
                if(cards.Count>=limit || scanned>=budget) return true;
            }
            group.Clear();
            return false;
        };
        for(dynamic mail=items.GetFirst(); mail!=null; mail=items.GetNext()) {
            DateTime when;
            string id;
            try { when=(DateTime)mail.ReceivedTime; id=(string)mail.EntryID; }
            catch(Exception ex) { if(!IsItemReadError(ex)) throw; continue; }
            if(first) {
                first=false;
                if(restricted && when>after.Value) return null;
            }
            if(after.HasValue && when<after.Value) continue;
            if(group.Count>0 && when!=groupTime && flush()) { stopped=true; break; }
            if(group.Count==0) groupTime=when;
            group.Add(new KeyValuePair<string,object>(id,(object)mail));
        }
        if(restricted && first) return null;
        if(!stopped && group.Count>0) stopped=flush();
        return new { cards, next=stopped ? next : (string)null };
    }

    private object BacklogCard(dynamic mail)
    {
        try {
            if((int)mail.Class!=43) return null;
            string[] all=Categories((string)mail.Categories);
            string status=StatusOf(all);
            if(status=="Erledigt") return null;
            return Card(mail,inbox,all,status);
        } catch(Exception ex) {
            if(!IsItemReadError(ex)) throw;
            return null;
        }
    }

    private static bool DoneExpired(dynamic mail,int days)
    {
        object when=ReadProperty(mail,"KanbanStatusSeit");
        DateTime stamp=when is DateTime ? (DateTime)when : (DateTime)mail.LastModificationTime;
        return stamp<DateTime.Now.AddDays(-days);
    }

    private List<object> BoardRows(dynamic folder,int days,int doneDays,int limit)
    {
        string query=string.Join(" OR ",States.Select(s=>"[Categories] = '"+(prefix+s).Replace("'","''")+"'"));
        dynamic items=folder.Items, tracked;
        int scan=5000;
        try { tracked=items.Restrict(query); }
        catch(COMException ex) {
            if(!IsItemReadError(ex) && ex.ErrorCode!=unchecked((int)0x80070057) &&
                ex.ErrorCode!=unchecked((int)0x80004001)) throw;
            tracked=items;
            scan=20000;
        }
        tracked.Sort("[ReceivedTime]",true);
        var seen=new HashSet<string>(IgnoreCase);
        var rows=SafeCards((object)folder,(object)tracked,scan,null,doneDays,true,false,seen).ToList();
        if(!Same((string)folder.EntryID,inboxId)) return rows;
        DateTime? cutoff=days>0 ? (DateTime?)DateTime.Now.AddDays(-days) : null;
        items.Sort("[ReceivedTime]",true);
        rows.AddRange(SafeCards((object)folder,(object)items,limit,cutoff,doneDays,false,false,seen));
        return rows;
    }
}
