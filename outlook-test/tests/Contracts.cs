using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

// Deterministic fake for the Outlook members used by the production helper command dispatcher.
// Emulate Outlook assigning a new EntryID and invalidating the old ID on every move.
internal static class Contracts
{
    internal class FakeFolders : List<FakeFolder>
    {
        public FakeFolder Owner;
        public FakeFolder Add(string name,int kind) { return new FakeFolder(name,Guid.NewGuid().ToString("N"),Owner); }
        public FakeFolder Item(string name) { return this.Single(f=>f.Name==name); }
    }

    internal class FakeDraft
    {
        public int BodyFormat=2;
        public string HTMLBody="<html><body class=x><p>Zitat</p></body></html>";
        public bool Displayed;
        public void Display(bool modal) { Displayed=true; }
    }

    internal class FakeFolder
    {
        public string Name, EntryID, StoreID="00";
        public int DefaultItemType=0;
        public FakeFolder Parent;
        public FakeFolders Folders=new FakeFolders();
        public void MoveTo(FakeFolder parent) { Parent.Folders.Remove(this); Parent=parent; parent.Folders.Add(this); EntryID+="F"; }
        public FakeItems Items=new FakeItems();

        public FakeFolder(string name, string id, FakeFolder parent=null)
        {
            Name=name; EntryID=id; Parent=parent; Folders.Owner=this;
            if (parent!=null) parent.Folders.Add(this);
        }
    }

    internal class FakeItems
    {
        public List<FakeMail> values=new List<FakeMail>();
        private int index;
        public bool Descending;
        public int Count { get { return values.Count; } }
        public FakeItems Restrict(string query) { return this; }
        public void Sort(string field,bool descending)
        {
            Check(field=="[ReceivedTime]" || field=="[SentOn]","Sortierfeld"); Descending=descending;
        }
        public FakeMail GetFirst() { index=-1; return GetNext(); }
        public FakeMail GetNext() { index++; return index<values.Count?values[index]:null; }
    }

    internal class FakeProps
    {
        internal class Prop
        {
            public object Value;
            private readonly Action delete;
            public Prop(Action delete) { this.delete=delete; }
            public void Delete() { delete(); }
        }
        private readonly Dictionary<string,Prop> values=new Dictionary<string,Prop>();
        public Prop Add(string name,int type,bool export) {
            var p=new Prop(()=>values.Remove(name)); values.Add(name,p); return p;
        }
        public Prop Find(string name) { Prop p; return values.TryGetValue(name,out p)?p:null; }
    }

    internal class FakeAttachments { public int Count { get { return 0; } } }

    internal class FakeMail
    {
        public int Class=43;
        public int SubjectError;
        public string Subject { get {
            if(SubjectError!=0) throw new System.Runtime.InteropServices.COMException("Mailfehler",SubjectError);
            return "Testmail";
        }}
        public string EntryID="AB01", SenderName="Test", SenderEmailAddress="labor@example.test", Body="intern",
            Categories="Wichtig; Status: Warten; Einkauf", ConversationID="Unterhaltung", MessageClass="IPM.Note";
        public DateTime ReceivedTime = DateTime.Now.AddDays(-1);
        public FakeFolder Parent;
        public FakeProps UserProperties=new FakeProps();
        public FakeDraft Draft=new FakeDraft();
        public string DraftMode;
        public FakeDraft Reply() { DraftMode="reply"; return Draft; }
        public FakeDraft ReplyAll() { DraftMode="all"; return Draft; }
        public FakeDraft Forward() { DraftMode="forward"; return Draft; }
        public FakeAttachments Recipients=new FakeAttachments();
        public string To="Einkauf";
        public DateTime LastModificationTime=DateTime.Now, SentOn=DateTime.Now;
        public FakeAttachments Attachments=new FakeAttachments();
        public int Saves;
        public bool Busy;
        public void Save() { Saves++; }
        public FakeMail Move(FakeFolder target)
        {
            if (Busy) throw new InvalidOperationException("Outlook beschäftigt");
            Parent.Items.values.Remove(this); Parent=target; target.Items.values.Add(this);
            EntryID+="A";
            return this;
        }
    }

    internal class FakeCategory { public string Name; public int Color; }
    internal class FakeCategories : List<FakeCategory> {
        public void Add(string name,int color) { base.Add(new FakeCategory{Name=name,Color=color}); }
    }
    internal class FakeNamespace
    {
        public FakeFolder Inbox, Archive, Foreign, Sent;
        public FakeCategories Categories=new FakeCategories();
        public List<object> Accounts=new List<object>();
        public class User { public string Address="ich@example.test"; }
        public User CurrentUser=new User();
        public FakeMail Mail;
        public FakeNamespace() {
            var root=new FakeFolder("Postfach","00");
            Inbox=new FakeFolder("Posteingang","01",root);
            var sub=new FakeFolder("Projekt","02",Inbox);
            Archive=new FakeFolder("Ablage","03",root);
            Sent=new FakeFolder("Gesendet","05",root);
            Foreign=new FakeFolder("Anderes Konto","04");
            Foreign.StoreID="44";
            Mail=new FakeMail {Parent=Inbox}; Inbox.Items.values.Add(Mail);
        }
        public FakeFolder GetFolderFromID(string id,string store) {
            return Find(Inbox.Parent,id) ?? (Foreign.EntryID==id ? Foreign : null);
        }
        private static FakeFolder Find(FakeFolder f,string id) {
            if(f.EntryID==id) return f;
            foreach(var sub in f.Folders) { var hit=Find(sub,id); if(hit!=null) return hit; }
            return null;
        }
        public FakeFolder GetDefaultFolder(int kind) { return kind==6 ? Inbox : kind==5 ? Sent : null; }
        public FakeMail GetItemFromID(string id,string store) {
            if(store!=Inbox.StoreID || id!=Mail.EntryID)throw new InvalidOperationException("Mail nicht gefunden");
            return Mail;
        }
    }

    private static void Check(bool condition,string error) { if (!condition) throw new Exception(error); }
    private static void Rejected(Action action) {
        try { action(); } catch (InvalidOperationException) { return; }
        throw new Exception("Fehler erwartet");
    }

    public static void Main()
    {
        var ns=new FakeNamespace();
        var commands=new BoardCommands(ns, ns.Inbox, ";");
        Func<string[],object> call=args=>commands.Execute(args,s=>s.Split('|'));
        var folders=(List<object>)call(new[]{"--folders"});
        Check(folders.Select(f=>(string)((dynamic)f).path).SequenceEqual(new[]{"","Projekt","/Ablage","/Gesendet"}),"Ordnerpfade");
        Check(folders.Select(f=>(int?)((dynamic)f).count).SequenceEqual(new int?[]{1,0,0,0}),"Mailanzahl je Ordner");
        var cards=(List<object>)call(new[]{"--inbox"});
        dynamic card=cards.Single();
        Check(card.folderId=="01" && card.body=="intern" && card.status=="Warten","Karte");
        Check(ns.Inbox.Items.Descending && card.senderEmail=="labor@example.test","Sortierung und SMTP");
        var unreadable=new FakeMail {EntryID="BA01",Parent=ns.Inbox,SubjectError=unchecked((int)0x80070005)};
        ns.Inbox.Items.values.Insert(0,unreadable);
        var reads=new[]{new[]{"--inbox"},new[]{"--folder","01"},new[]{"--backlog"},new[]{"--board","03"}};
        foreach(var read in reads)
            Check(((dynamic)((List<object>)call(read)).Single()).id=="AB01","Fehlerhafte Mail überspringen: "+read[0]);
        foreach(int code in new[]{unchecked((int)0x8001010A),unchecked((int)0x80010108)}) {
            unreadable.SubjectError=code;
            foreach(var read in reads) {
                try { call(read); throw new Exception("Sitzungsfehler erwartet: "+read[0]); }
                catch(System.Runtime.InteropServices.COMException ex) { Check(ex.ErrorCode==code,"COM-Sitzungsfehler weitergeben"); }
            }
        }
        ns.Inbox.Items.values.Remove(unreadable);
        ns.Inbox.Items.values.Add(new FakeMail {Parent=ns.Inbox,Categories="Status: Erledigt"});
        Check(((List<object>)call(new[]{"--backlog"})).Count==1 && !ns.Inbox.Items.Descending,"Aufräumen");
        ns.Inbox.Items.values.RemoveAt(1);
        ns.Mail.MessageClass="IPM.Note.SMIME";
        Check(((dynamic)((List<object>)call(new[]{"--inbox"})).Single()).body=="","S/MIME-Text");
        dynamic move=call(new[]{"--move","AB01","01","03"});
        Check(move.id=="AB01A" && move.source=="01" && move.target=="03","Neue EntryID");
        Check(((List<object>)call(new[]{"--inbox"})).Count==0,"Aktualisierter Posteingang");
        Check(((List<object>)call(new[]{"--folder","03"})).Count==1,"Ablage nach Aktualisieren");
        Rejected(()=>call(new[]{"--undo","AB01","03","01"}));
        Rejected(()=>call(new[]{"--undo","AB01A","01","03"}));
        Rejected(()=>call(new[]{"--move","AB01A","03","04"}));
        ns.Mail.Busy=true;
        Rejected(()=>call(new[]{"--undo","AB01A","03","01"}));
        Check(ns.Mail.Parent==ns.Archive && ns.Mail.EntryID=="AB01A","Fehler darf nicht verschieben");
        ns.Mail.Busy=false;
        dynamic undone=call(new[]{"--undo","AB01A","03","01"});
        Check(undone.id=="AB01AA" && ns.Mail.Parent==ns.Inbox,"Rückgängig");
        dynamic status=call(new[]{"--status","AB01AA","01","Erledigt"});
        Check(status.previous=="Warten" && ns.Mail.Categories=="Status: Erledigt; Wichtig; Einkauf","Kategorienerhalt");
        call(new[]{"--status","AB01AA","01",""});
        Check(ns.Mail.Categories=="Wichtig; Einkauf","Status entfernen");
        dynamic before=call(new[]{"--status","AB01AA","01","Offen"});
        Check(before.previous=="","Unkategorisierter Ausgangszustand");
        call(new[]{"--tags","AB01AA","01","Wichtig","Prüfen"});
        Check(ns.Mail.Categories=="Status: Offen; Einkauf; Prüfen","Parallel hinzugekommenes Schlagwort");
        call(new[]{"--field","AB01AA","01","followUp","2026-12-04"});
        dynamic clear=call(new[]{"--field","AB01AA","01","followUp",""});
        Check(clear.previous=="2026-12-04" && ns.Mail.UserProperties.Find("KanbanNachfassen")==null,"Frist löschen");
        call(new[]{"--field","AB01AA","01","note","Prüfen"});
        Check(((dynamic)((List<object>)call(new[]{"--inbox"})).Single()).note=="Prüfen","Notiz");
        call(new[]{"--draft","AB01AA","01","reply","Muster < &"});
        Check(ns.Mail.Draft.Displayed && ns.Mail.DraftMode=="reply" &&
            ns.Mail.Draft.HTMLBody=="<html><body class=x><p>Muster &lt; &amp;</p><p>Zitat</p></body></html>","HTML-Entwurf");
        call(new[]{"--draft","AB01AA","01","follow-up",""});
        Check(ns.Mail.DraftMode=="all","Nachfassen");
        dynamic created=call(new[]{"--folder-create","00","Projekt X"});
        Check(created.path=="/Projekt X" && created.parentId=="00","Ordner anlegen");
        string cid=created.id;
        dynamic renamed=call(new[]{"--folder-rename",cid,"Projekt Y"});
        Check(renamed.previousName=="Projekt X" && renamed.name=="Projekt Y","Umbenennen");
        Rejected(()=>call(new[]{"--folder-rename","01","Posteingang NEU"}));
        Rejected(()=>call(new[]{"--folder-move",cid,"00",cid}));
        dynamic archived=call(new[]{"--folder-move",cid,"00","03"});
        Check(archived.previousParentId=="00" && archived.path=="/Ablage/Projekt Y" && archived.id!=cid,"Abschließen");
        dynamic correspondence=call(new[]{"--correspondence","30","03"});
        Check(correspondence.incoming.Count==1 && correspondence.sent.Count==0,"Posteingang ohne Gesendet");
        ns.Sent.Items.values.Add(new FakeMail{Parent=ns.Sent,EntryID="C1",Categories=""});
        correspondence=call(new[]{"--correspondence","30","03"});
        Check(correspondence.sent.Count==1 && ((dynamic)correspondence.sent[0]).isSent,"Gesendet");
        var multi=(List<object>)call(new[]{"--board","03","0","14","500"});
        Check(multi.Count==1,"Statuslose gesendete Mails gehören nicht aufs Board");
        var training=(List<object>)call(new[]{"--training","01","300","0"});
        Check(training.Count==1 && ((dynamic)training[0]).id=="AB01AA","Lernbeispiele");
        string aid=archived.id;
        dynamic reopened=call(new[]{"--folder-move",aid,"03","01"});
        Check(reopened.path=="Projekt Y","Wieder öffnen");
        var colors=(List<object>)call(new[]{"--sync-colors","8","2","4","5"});
        Check(colors.Count>=4 && ns.Categories.Single(c=>c.Name=="Status: Erledigt").Color==5,"Outlook-Kategoriefarben");
        var localized = new BoardCommands(ns,ns.Inbox,";","Büro: ");
        localized.Execute(new[]{"--status","AB01AA","01","Warten","2025-01-01T09:30:00"},null);
        Check(ns.Mail.Categories.StartsWith("Büro: Warten") &&
            ((DateTime)ns.Mail.UserProperties.Find("KanbanStatusSeit").Value).Year==2025,"Präfix und Zeitwiederherstellung");
        foreach(string field in new[]{"note","followUp","snoozeUntil"}) {
            string first=field=="note"?"Text vom Board":"2026-11-22";
            string external=field=="note"?"Parallel geändert":"2026-12-01";
            dynamic initial=call(new[]{"--field","AB01AA","01",field,first});
            call(new[]{"--field","AB01AA","01",field,external});
            int saves=ns.Mail.Saves;
            string original=initial.previous;
            dynamic mismatch=call(new[]{"--field","AB01AA","01",field,original,first});
            Check(mismatch.conflict && ns.Mail.Saves==saves,"Konflikt erhält "+field);
            dynamic current=call(new[]{"--field","AB01AA","01",field,first});
            Check(current.previous==external,"Paralleländerung erhalten");
            dynamic retried=call(new[]{"--field","AB01AA","01",field,original,first});
            Check(retried.previous==first && retried.value==original,"Undo mit passendem Wert: "+field);
        }
        dynamic changed=call(new[]{"--status","AB01AA","01","Warten"});
        string oldStatus=changed.previous, oldSince=changed.previousSince, expectedSince=changed.statusSince;
        call(new[]{"--status","AB01AA","01","Erledigt"});
        int statusSaves=ns.Mail.Saves;
        string[] revert={"--status","AB01AA","01",oldStatus,oldSince,"Warten",expectedSince};
        dynamic blocked=call(revert);
        Check(blocked.conflict && ns.Mail.Saves==statusSaves && ns.Mail.Categories.Contains("Status: Erledigt"),"Fremdstatus erhalten");
        call(new[]{"--status","AB01AA","01","Warten","2025-12-20T10:00:00"});
        statusSaves=ns.Mail.Saves;
        blocked=call(revert);
        Check(blocked.conflict && ns.Mail.Saves==statusSaves,"Gleicher Status mit neuerem Stichtag bleibt erhalten");
        call(new[]{"--status","AB01AA","01","Warten",expectedSince});
        dynamic restored=call(revert);
        Check(restored.previous=="Warten" && restored.status==oldStatus && restored.statusSince==oldSince,"Status und Stichtag rückgängig");
        Backlog();
        Console.WriteLine("OK: Undo-Wertkonflikte, Zeitstempel und Wiederholung");
        Console.WriteLine("OK: Projektordner, HTML-Entwurf, Nachfassen");
        Console.WriteLine("OK: Ordner, Karten, Verschlüsselt, Move/Undo über Refresh, Fehler, Status, Tags, Fristen, Notiz");
    }

    // Seitenweiser Rückstand (E7): Grenze und Versatz, älteste zuerst, ohne Erledigte. Ohne Parameter wie bisher.
    private static void Backlog()
    {
        var ns=new FakeNamespace();
        ns.Inbox.Items.values.Clear();
        for(int i=0;i<360;i++)
            ns.Inbox.Items.values.Add(new FakeMail {EntryID="M"+i,Parent=ns.Inbox,Categories=i%10==3?"Status: Erledigt":"",
                ReceivedTime=DateTime.Now.AddDays(-400+i)});
        ns.Inbox.Items.values.Insert(5,new FakeMail {EntryID="BAD",Parent=ns.Inbox,Categories="",SubjectError=unchecked((int)0x80070005)});
        var commands=new BoardCommands(ns, ns.Inbox, ";");
        Func<string[],List<string>> ids=args=>((List<object>)commands.Execute(args,s=>s.Split('|'))).Select(c=>(string)((dynamic)c).id).ToList();
        var all=ids(new[]{"--backlog"});
        Check(all.Count==300 && all[0]=="M0" && !ns.Inbox.Items.Descending,"Rückstand ohne Parameter: älteste 300");
        Check(!all.Contains("BAD") && !all.Contains("M3"),"Rückstand ohne Unlesbare und Erledigte");
        var first=ids(new[]{"--backlog","20","0"});
        var second=ids(new[]{"--backlog","20","20"});
        Check(first.Count==20 && second.Count==20,"Grenze eingehalten");
        Check(!first.Intersect(second).Any(),"Seiten überschneiden sich nicht");
        Check(first.Concat(second).SequenceEqual(all.Take(40)),"Seiten lückenlos in der Reihenfolge");
        var whole=ids(new[]{"--backlog","5000","0"});
        Check(whole.Count==324 && whole.Take(300).SequenceEqual(all),"Alle Seiten zusammen");
        var last=ids(new[]{"--backlog","100","250"});
        Check(last.Count==74 && last.SequenceEqual(whole.Skip(250)),"Letzte Seite kürzer");
        Check(ids(new[]{"--backlog","20","400"}).Count==0,"Seite hinter dem Ende ist leer");
        foreach(var bad in new[]{new[]{"--backlog","0","0"},new[]{"--backlog","20"},new[]{"--backlog","x","0"},new[]{"--backlog","20","-1"}}) {
            try { ids(bad); throw new Exception("Ungültige Seite angenommen: "+string.Join(" ",bad)); }
            catch(ArgumentException) { }
        }
        Console.WriteLine("OK: Rückstand seitenweise");
    }
}
