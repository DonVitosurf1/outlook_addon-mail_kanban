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
        public static int Visits;
        public static readonly List<string> Restrictions=new List<string>();
        // Verhalten der Einschränkung: Outlook (Standard), falsch verstandenes Datum, Fehler oder andere Reihenfolge gleich alter Mails.
        public enum RestrictMode { Outlook, Misparse, Fails, ReorderTies }
        public static RestrictMode Mode=RestrictMode.Outlook;
        // Wie Outlook: Datumsvergleich minutengenau, Datum im Format der Ländereinstellung.
        public FakeItems Restrict(string query) {
            const string prefix="[ReceivedTime] >= '";
            if(!query.StartsWith(prefix)) return this;
            Restrictions.Add(query);
            if(Mode==RestrictMode.Fails) throw new System.Runtime.InteropServices.COMException("Bedingung nicht verstanden",unchecked((int)0x80020009));
            DateTime from=DateTime.Parse(query.Substring(prefix.Length).TrimEnd('\''),System.Globalization.CultureInfo.CurrentCulture);
            from=new DateTime(from.Year,from.Month,from.Day,from.Hour,from.Minute,0);
            // Falsch verstanden (etwa Tag und Monat vertauscht): nur deutlich spätere Mails.
            if(Mode==RestrictMode.Misparse) from=from.AddDays(1);
            var hits=values.Where(m=>m.ReceivedTime>=from).ToList();
            // Andere Reihenfolge gleich alter Mails als im ganzen Ordner.
            if(Mode==RestrictMode.ReorderTies) hits=hits.GroupBy(m=>m.ReceivedTime).SelectMany(g=>g.Reverse()).ToList();
            return new FakeItems { values=hits };
        }
        public void Sort(string field,bool descending)
        {
            Check(field=="[ReceivedTime]" || field=="[SentOn]","Sortierfeld"); Descending=descending;
        }
        public FakeMail GetFirst() { index=-1; return GetNext(); }
        public FakeMail GetNext() { index++; Visits++; return index<values.Count?values[index]:null; }
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
        // --folders bleibt schnell und zählt nicht. Zahlen gibt es nur auf Anfrage, für alle oder die genannten Ordner.
        Check(folders.All(f=>f.GetType().GetProperty("count")==null),"Ordnerliste ohne Zahlen");
        var deepParent=ns.Inbox;
        for(int i=1;i<=8;i++) deepParent=new FakeFolder("E"+i,"D"+i,deepParent);
        var deep=(List<object>)call(new[]{"--folders"});
        Check(deep.Any(f=>(string)((dynamic)f).name=="E7") && deep.All(f=>(string)((dynamic)f).name!="E8"),"Achte Ebene bleibt, die neunte fehlt");
        dynamic edge=deep.Single(f=>(string)((dynamic)f).name=="E7");
        Check((int)edge.omitted==1,"Abgeschnittene Unterordner werden gezählt");
        Check((int)((dynamic)deep.Single(f=>(string)((dynamic)f).path=="")).omitted==0,"Sichtbare Ordner ohne abgeschnittene Kinder");
        ns.Inbox.Folders.RemoveAt(ns.Inbox.Folders.Count-1);
        var counts=(List<object>)call(new[]{"--folder-counts"});
        Check(counts.Select(c=>(string)((dynamic)c).id+"="+(int?)((dynamic)c).count).SequenceEqual(new[]{"01=1","02=0","03=0","05=0"}),"Mailanzahl je Ordner");
        var some=(List<object>)call(new[]{"--folder-counts","03|01|unbekannt|04|01"});
        Check(some.Select(c=>(string)((dynamic)c).id+"="+(int?)((dynamic)c).count).SequenceEqual(new[]{"03=0","01=1"}),"Mailanzahl nur für genannte Ordner, ohne fremde und unbekannte");
        try { call(new[]{"--folder-counts","01","02"}); throw new Exception("Zu viele Argumente angenommen"); } catch(ArgumentException) { }
        var cards=(List<object>)call(new[]{"--inbox"});
        dynamic card=cards.Single();
        Check(card.folderId=="01" && card.body=="intern" && card.status=="Warten","Karte");
        Check(ns.Inbox.Items.Descending && card.senderEmail=="labor@example.test","Sortierung und SMTP");
        var older=new FakeMail{EntryID="T1",Parent=ns.Inbox,ConversationID="Unterhaltung",Body="Bitte das Angebot prüfen.",ReceivedTime=DateTime.Now.AddDays(-5)};
        ns.Inbox.Items.values.Add(older);
        var sentEarlier=new FakeMail{EntryID="T2",Parent=ns.Sent,ConversationID="Unterhaltung",Body="Hier das Angebot.",ReceivedTime=DateTime.Now.AddDays(-4),SenderEmailAddress=ns.CurrentUser.Address};
        ns.Sent.Items.values.Add(sentEarlier);
        var later=new FakeMail{EntryID="T3",Parent=ns.Inbox,ConversationID="Unterhaltung",Body="Später",ReceivedTime=DateTime.Now.AddDays(1)};
        ns.Inbox.Items.values.Add(later);
        var other=new FakeMail{EntryID="T4",Parent=ns.Inbox,ConversationID="Andere",Body="Fremd",ReceivedTime=DateTime.Now.AddDays(-3)};
        ns.Inbox.Items.values.Add(other);
        var thread=(List<object>)call(new[]{"--thread","AB01","01"});
        Check(thread.Count==2,"Zwei frühere Nachrichten");
        Check((string)((dynamic)thread[0]).direction=="gesendet" && ((string)((dynamic)thread[0]).text).Contains("Angebot"),"Neuere gesendete Nachricht zuerst");
        Check((string)((dynamic)thread[1]).direction=="eingegangen" && ((string)((dynamic)thread[1]).text).Contains("prüfen"),"Ältere eingegangene Nachricht");
        ns.Inbox.Items.values.Remove(older);ns.Inbox.Items.values.Remove(later);ns.Inbox.Items.values.Remove(other);ns.Sent.Items.values.Remove(sentEarlier);
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
        ns.Mail.SenderEmailAddress=ns.CurrentUser.Address;
        ns.Mail.Parent=ns.Sent;
        call(new[]{"--draft","AB01AA","05","reply","Nur an mich"});
        Check(ns.Mail.DraftMode=="reply","Antworten bleibt eine einzelne Antwort");
        call(new[]{"--draft","AB01AA","05","reply-all",""});
        Check(ns.Mail.DraftMode=="all","Allen antworten bleibt Allen antworten");
        ns.Mail.Parent=ns.Inbox;
        ns.Mail.SenderEmailAddress="labor@example.test";
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

    // Gleich alte Mails im Rückstand: feste Reihenfolge nach EntryID, nie mehr als die Grenze, keine Lücke, auch wenn die Einschränkung
    // anders sortiert, das Datum falsch versteht oder scheitert.
    private static void BacklogTies()
    {
        var t=new DateTime(2026,5,4,10,0,0);
        Func<FakeNamespace,BoardCommands> make=n=>new BoardCommands(n,n.Inbox,";");
        Func<BoardCommands,string[],dynamic> exec=(c,a)=>c.Execute(a,s=>s.Split('|'));
        Func<dynamic,List<string>> idsOf=p=>((List<object>)p.cards).Select(x=>(string)((dynamic)x).id).ToList();
        Func<BoardCommands,int,string,List<string>> all=(c,limit,cursor)=>{
            var got=new List<string>();
            for(int guard=0;guard<200;guard++) {
                dynamic page=exec(c,cursor==null ? new[]{"--backlog-page",limit.ToString()} : new[]{"--backlog-page",limit.ToString(),cursor});
                List<string> ids=idsOf(page);
                Check(ids.Count<=limit,"Nie mehr als die Grenze");
                got.AddRange(ids);
                cursor=page.next;
                if(cursor==null) return got;
            }
            throw new Exception("Kein Ende");
        };
        // (A) Fortsetzungsmail verschoben, danach nur noch gleich alte Mails.
        var ns=new FakeNamespace(); ns.Inbox.Items.values.Clear();
        for(int i=0;i<4;i++) ns.Inbox.Items.values.Add(new FakeMail{EntryID="T"+i,Parent=ns.Inbox,Categories="",ReceivedTime=t});
        var c=make(ns);
        dynamic head=exec(c,new[]{"--backlog-page","2"});
        Check(((List<string>)idsOf(head)).SequenceEqual(new[]{"T0","T1"}),"A: erste Seite");
        ns.Inbox.Items.values.RemoveAt(1);
        dynamic rest=exec(c,new[]{"--backlog-page","10",(string)head.next});
        Check(((List<string>)idsOf(rest)).SequenceEqual(new[]{"T2","T3"}) && rest.next==null,"A: gleich alte Mails am Ende nicht verloren: "+string.Join(",",((List<string>)idsOf(rest))));
        // (B) Fortsetzungsmail verschoben, mehr gleich alte Mails als die Grenze.
        ns=new FakeNamespace(); ns.Inbox.Items.values.Clear();
        for(int i=0;i<8;i++) ns.Inbox.Items.values.Add(new FakeMail{EntryID="U"+i,Parent=ns.Inbox,Categories="",ReceivedTime=t});
        ns.Inbox.Items.values.Add(new FakeMail{EntryID="V",Parent=ns.Inbox,Categories="",ReceivedTime=t.AddMinutes(5)});
        c=make(ns);
        head=exec(c,new[]{"--backlog-page","1"});
        ns.Inbox.Items.values.RemoveAt(0);
        var got=all(c,3,(string)head.next);
        Check(got.SequenceEqual(new[]{"U1","U2","U3","U4","U5","U6","U7","V"}),"B: "+string.Join(",",got));
        // Viele gleich alte Mails über mehrere Seiten, Outlook liefert sie im ganzen Ordner und in der Einschränkung verschieden sortiert.
        foreach(var mode in new[]{FakeItems.RestrictMode.ReorderTies,FakeItems.RestrictMode.Misparse,FakeItems.RestrictMode.Fails}) {
            FakeItems.Mode=mode;
            try {
                ns=new FakeNamespace(); ns.Inbox.Items.values.Clear();
                var expected=new List<string>();
                for(int minute=0;minute<3;minute++) {
                    var batch=Enumerable.Range(0,7).Select(i=>"W"+minute+"-"+(char)('g'-i)).ToList();
                    foreach(var id in batch) ns.Inbox.Items.values.Add(new FakeMail{EntryID=id,Parent=ns.Inbox,Categories=id.EndsWith("c")?"Status: Erledigt":"",ReceivedTime=t.AddMinutes(minute)});
                    expected.AddRange(batch.Where(id=>!id.EndsWith("c")).OrderBy(id=>id,StringComparer.Ordinal));
                }
                foreach(int limit in new[]{1,2,3,5}) {
                    got=all(make(ns),limit,null);
                    Check(got.SequenceEqual(expected),mode+" Grenze "+limit+": "+string.Join(",",got));
                }
            } finally { FakeItems.Mode=FakeItems.RestrictMode.Outlook; }
        }
        Console.WriteLine("OK: Rückstand mit gleich alten Mails, Einschränkung als Abkürzung");
    }

    // Seitenweiser Rückstand (E7): Grenze und Versatz, älteste zuerst, ohne Erledigte. Ohne Parameter wie bisher.
    private static void Backlog()
    {
        var ns=new FakeNamespace();
        ns.Inbox.Items.values.Clear();
        for(int i=0;i<360;i++)
            ns.Inbox.Items.values.Add(new FakeMail {EntryID="M"+i,Parent=ns.Inbox,Categories=i%10==3?"Status: Erledigt":"",
                ReceivedTime=DateTime.Now.AddDays(-400+i)});
        ns.Inbox.Items.values.Insert(5,new FakeMail {EntryID="BAD",Parent=ns.Inbox,Categories="",SubjectError=unchecked((int)0x80070005),
            ReceivedTime=ns.Inbox.Items.values[4].ReceivedTime.AddHours(1)});
        var commands=new BoardCommands(ns, ns.Inbox, ";");
        Func<string[],List<string>> ids=args=>((List<object>)commands.Execute(args,s=>s.Split('|'))).Select(c=>(string)((dynamic)c).id).ToList();
        var all=ids(new[]{"--backlog"});
        Check(all.Count==300 && all[0]=="M0" && !ns.Inbox.Items.Descending,"Rückstand ohne Parameter: älteste 300");
        Check(!all.Contains("BAD") && !all.Contains("M3"),"Rückstand ohne Unlesbare und Erledigte");
        // Seitenweise mit Fortsetzungspunkt: lückenlos, ohne Überschneidung, in der Reihenfolge, je Seite höchstens die Grenze.
        Func<int,List<List<string>>> pages=limit=>{
            var result=new List<List<string>>();
            string cursor=null;
            for(int guard=0;guard<1000;guard++) {
                var args=cursor==null ? new[]{"--backlog-page",limit.ToString()} : new[]{"--backlog-page",limit.ToString(),cursor};
                dynamic page=commands.Execute(args,s=>s.Split('|'));
                var cards=((List<object>)page.cards).Select(c=>(string)((dynamic)c).id).ToList();
                Check(cards.Count<=limit,"Grenze eingehalten");
                result.Add(cards);
                cursor=page.next;
                if(cursor==null) return result;
            }
            throw new Exception("Kein Ende des Rückstands");
        };
        dynamic whole=commands.Execute(new[]{"--backlog-page","5000"},s=>s.Split('|'));
        var expected=((List<object>)whole.cards).Select(c=>(string)((dynamic)c).id).ToList();
        Check(whole.next==null && expected.Count==324 && expected.Take(300).SequenceEqual(all),"Alle Seiten zusammen");
        Contracts.FakeItems.Visits=0;
        var twenty=pages(20);
        var flat=twenty.SelectMany(p=>p).ToList();
        Check(twenty[0].Count==20 && twenty[1].Count==20,"Volle Seiten");
        Check(flat.Count==flat.Distinct().Count(),"Seiten überschneiden sich nicht");
        Check(flat.SequenceEqual(expected),"Seiten lückenlos in der Reihenfolge");
        // Jede Seite springt zum Fortsetzungspunkt: insgesamt etwa einmal durch den Posteingang statt quadratisch.
        Check(Contracts.FakeItems.Visits<2*361+twenty.Count*3,"Keine erneut gelesenen Vorseiten: "+Contracts.FakeItems.Visits);
        Check(Contracts.FakeItems.Restrictions.Count>=twenty.Count-1,"Einschränkung auf die Empfangszeit");

        // Viele Erledigte am Stück: kurze oder leere Seiten, aber keine Lücke und kein vorzeitiges Ende.
        for(int i=40;i<300;i++) ns.Inbox.Items.values[i].Categories="Status: Erledigt";
        var sparse=pages(10);
        var open=sparse.SelectMany(p=>p).ToList();
        var expectedOpen=ns.Inbox.Items.values.Where(m=>m.EntryID!="BAD" && m.Categories!="Status: Erledigt").Select(m=>m.EntryID).ToList();
        Check(sparse.Any(p=>p.Count==0),"Leere Seite mitten im Rückstand");
        Check(open.SequenceEqual(expectedOpen),"Keine Lücke bei vielen Erledigten");

        // Gleich alte Mails über eine Seitengrenze und in anderer Ländereinstellung.
        var culture=System.Globalization.CultureInfo.CurrentCulture;
        System.Globalization.CultureInfo.CurrentCulture=new System.Globalization.CultureInfo("de-DE");
        try {
            var same=DateTime.Now.AddDays(-2);
            same=new DateTime(same.Year,same.Month,same.Day,same.Hour,same.Minute,same.Second);
            ns.Inbox.Items.values.Clear();
            for(int i=0;i<9;i++)
                ns.Inbox.Items.values.Add(new FakeMail {EntryID="T"+i,Parent=ns.Inbox,Categories="",ReceivedTime=i<6 ? same : same.AddSeconds(i)});
            var tied=pages(4);
            Check(tied.SelectMany(p=>p).SequenceEqual(Enumerable.Range(0,9).Select(i=>"T"+i)),"Gleich alte Mails ohne Lücke und doppelt");
            // Die Mail des Fortsetzungspunkts ist inzwischen verschoben: es geht nach EntryID weiter, ohne Lücke und ohne Doppelte.
            dynamic head=commands.Execute(new[]{"--backlog-page","2"},s=>s.Split('|'));
            ns.Inbox.Items.values.RemoveAt(1);
            dynamic rest=commands.Execute(new[]{"--backlog-page","10",(string)head.next},s=>s.Split('|'));
            var again=((List<object>)rest.cards).Select(c=>(string)((dynamic)c).id).ToList();
            Check(again.SequenceEqual(new[]{"T2","T3","T4","T5","T6","T7","T8"}) && rest.next==null,"Verschobene Fortsetzungsmail: "+string.Join(",",again));
        } finally { System.Globalization.CultureInfo.CurrentCulture=culture; }
        BacklogTies();
        foreach(var bad in new[]{new[]{"--backlog-page","0"},new[]{"--backlog-page"},new[]{"--backlog-page","x"},new[]{"--backlog","20","0"},
            new[]{"--backlog-page","20","kein"},new[]{"--backlog-page","20","-5|M1"},new[]{"--backlog-page","20","5|"}}) {
            try { ids(bad); throw new Exception("Ungültige Seite angenommen: "+string.Join(" ",bad)); }
            catch(ArgumentException) { }
        }
        Console.WriteLine("OK: Rückstand seitenweise");
    }
}
