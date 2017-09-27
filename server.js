/*
The main server script

Copyright (C) 2016  Alexei Frolov, Larry Zhang
Developed at University of Toronto

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

var express = require('express');
var session = require('express-session');
var bodyParser = require('body-parser');
var multer = require('multer');
var db = require('./server/db.js');
var users = require('./server/users.js');
var questions = require('./server/questions.js');
var lb = require('./server/leaderboard.js');
var log = require('./server/log.js');
var logger = log.logger;
var pug = require('pug');
var common = require('./server/common.js');

var app = express();
var port = process.env.QUIZZARD_PORT || 8000;

var upload = multer({ dest: 'uploads/' });

/* print urls of all incoming requests to stdout */
app.use(function(req, res, next) {
    logger.info("Request path: %s",req.url);
    next();
});

app.set('view engine', 'pug');
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'test',
    resave: true,
    saveUninitialized: false
}));

/* main page */
app.get('/', function(req, res) {
    /* if the user has already logged in, redirect to home */
    if (req.session.user != null)
        res.redirect('home');
    else
        res.render('login');
});

/* check username and password and send appropriate response */
app.get('/login', function(req, res) {
    var username = req.query.user.toLowerCase();
    var password = req.query.passwd;
    logger.info('Attempted login by user %s', username);
    users.checkLogin(username, password, function(user) {
        if (user) {
            logger.info('User %s logged in.', username);
            req.session.user = user;
            res.status(200).send('success');
        } else {
            res.status(403).send('invalid');
        }
    });
});

/* Process a password changing request. */
app.post('/changepass', function(req, res) {
    if (!req.session.user)
        return res.status(500).send();

    if (req.body.newpass != req.body.newpass2)
        return res.status(500).send('mismatch');

    var userId = req.session.user.id;
    var currentPass = req.body.currpass;
    var newPass = req.body.newpass;

    users.checkLogin(userId, currentPass, function(user) {
        if (user) {
            users.updateUserByIdWithRedirection(user.id, {newPassword:newPass}, function(result){
                if (result == 'success') {
                    logger.info('User %s changed their password.', user.id);
                }
                var code = (result === 'success') ? 200 : 500;
                res.status(code).send(result);
            });
        } else {
            res.status(500).send('invalid');
        }
    });
});

/* End a user's session. */
app.get('/logout', function(req, res) {
    if (req.session.user != null) {
        logger.info('User %s logged out.', req.session.user.id);
        req.session.destroy();
        res.status(200).send();
    } else {
        res.status(500).send();
    }
});

/* Display the home page. */
app.get('/home', function(req, res) {
    /* if the user has not yet logged in, redirect to login page */
    if (req.session.user == null) {
        res.redirect('/')
    } else if (req.session.user.type==common.userTypes.ADMIN) {
        res.redirect('/admin')
    } else {
        if (req.session.questions == null) {
            /* fetch some questions from the database if the user doesn't have any */
            questions.findQuestions(10, common.sortTypes.SORT_RANDOM,
                                   req.session.user, function(results) {
                req.session.questions = results;
                req.session.answeredQuestions = false;
                res.render('home', {
                    user: req.session.user,
                    questions: results
                });
            });
        } else {
            res.render('home', {
                user: req.session.user,
                questions: req.session.questions,
                answered: req.session.answeredQuestions
            });
        }
    }
});

/* Display the question page. */
app.get('/question', function(req, res) {
    /* if the user has not yet logged in, redirect to login page */
    if (req.session.user == null)
        res.redirect('/')
    else if (req.session.question == null)
        res.redirect('/home')
    else
        res.render('question', {
            user: req.session.user,
            question: req.session.question,
            answered: req.session.questionAnswered,
            preview: false
        });
});

/* Display the leaderboard page. */
app.get('/leaderboard', function(req, res) {
    if (req.session.user == null)
        res.redirect('/')
    else
        res.render('leaderboard', { user: req.session.user });
});

/* Display the admin page. */
app.get('/admin', function(req,res) {
    if (req.session.user == null)
        res.redirect('/');
    else if (!req.session.user.type==common.userTypes.ADMIN)
        res.redirect('/home')
    else
        res.render('admin', { user: req.session.user });
});

/* Display the about page. */
app.get('/about', function(req,res) {
    if (req.session.user == null)
        res.redirect('/')
    else
        res.render('about', { user: req.session.user });
});

/* Pre-compiled Pug views */
const studentTable = pug.compileFile('views/account-table.pug');
const accountForm = pug.compileFile('views/account-creation.pug');
const accountEdit = pug.compileFile('views/account-edit.pug');
const questionTable = pug.compileFile('views/question-table.pug');
const questionForm = pug.compileFile('views/question-creation.pug');
const questionEdit = pug.compileFile('views/question-edit.pug');
const statistics = pug.compileFile('views/statistics.pug');

const leaderboardTable = pug.compileFile('views/leaderboard-table.pug');

/* Fetch and render the leaderboard table. Send HTML as response. */
app.get('/leaderboard-table', function(req, res) {
    var ft, shrt;

    ft = true;
    shrt = false;

    if (req.query.fullTable == 'false')
        ft = false;
    if (req.query.longTable == 'false')
        shrt = true;

    lb.leaderboard(req.session.user.id, shrt, function(leader) {
        var html = leaderboardTable({
            fullTable: ft,
            shortTable: shrt,
            leaderboard: leader,
            userid: req.session.user.id
        });
        res.status(200).send(html);
    });
});

/* refetch users from database instead of using stored list */
var refetch = false;

/* Send the student table HTML. */
app.get('/studentlist', function(req, res) {
    /* only fetch student list once, then store it */
    users.getStudentsList(function(studentlist) {
        refetch = false;
        req.session.adminStudentList = studentlist;
        var html = studentTable({
            students: studentlist
        });
        res.status(200).send(html);
    });
});

/* Sort the list of student accounts by the specified criterion. */
app.post('/sortaccountlist', function(req, res) {
    if (req.session.adminStudentList == null) {
        var html = studentTable({
            students: []
        });
        res.status(200).send(html);
    } else {
        students.sortAccounts(
            req.session.adminStudentList,
            req.body.type,
            req.body.asc == 'true',
            function(result) {
                var html = studentTable({
                    students: result
                });
                res.status(200).send(html);
            }
        );
    }
});

/* Send the account creation form HTML. */
app.get('/accountform', function(req, res) {
    var html = accountForm();
    res.status(200).send(html);
});

/* Send the question creation form HTML. */
app.get('/questionform', function(req, res) {
    var html = questionForm();
    res.status(200).send(html);
});

/* Return a formatted date for the given timestamp. */
var creationDate = function(timestamp) {
    const months = ['Jan', 'Feb', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var date = new Date(timestamp);
    return months[date.getMonth() - 1] + ' ' + date.getDate() + ' ' + date.getFullYear();
}

/* Send the account editing form HTML. */
app.post('/accountedit', function(req, res) {
    /* Find the requested user */
    var ind;
    for (ind in req.session.adminStudentList) {
        if (req.session.adminStudentList[ind].id == req.body.userid)
            break;
    }

    var html = accountEdit({
        user: req.session.adminStudentList[ind],
        cdate: creationDate(req.session.adminStudentList[ind].ctime * 1000)
    });
    res.status(200).send(html);
});

/* Send the question table HTML. */
app.get('/questionlist', function(req, res) {
    /* If this is the first time accessing it, fetch list from database. */
    questions.findQuestions(
        0,
        common.sortTypes.SORT_DEFAULT,
        null,
        function(questionlist) {
            req.session.adminQuestionList = questionlist;
            var html = questionTable({
                questions: questionlist
            });
            res.status(200).send(html);
        }
    );
});

/* Send the question editing form HTML. */
app.post('/questionedit', function(req, res) {
    var ind;
    for (ind in req.session.adminQuestionList) {
        if (req.session.adminQuestionList[ind].id == req.body.questionid)
            break;
    }

    var html = questionEdit({
        question: req.session.adminQuestionList[ind]
    });
    res.status(200).send({
        html: html,
        qtext: req.session.adminQuestionList[ind].text
    });
});

/* Send the application statistics HTML. */
app.get('/statistics', function(req, res) {
    if (req.session.adminQuestionList == null) {
        questions.findQuestions(
            0,
            common.sortTypes.SORT_DEFAULT,
            null,
            function(questionlist) {
                req.session.adminQuestionList = questionlist;
                var html = statistics({
                    students: req.session.adminStudentList,
                    questions: req.session.adminQuestionList
                });
                res.status(200).send(html);
            });
    } else {
        var html = statistics({
            students: req.session.adminStudentList,
            questions: req.session.adminQuestionList
        });
        res.status(200).send(html);
    }
});

app.get('/sortlist', function(req, res) {
    res.status(200).send(common.sortTypes);
});

const questionList = pug.compileFile('views/questionlist.pug');

/* Respond with an HTML-formatted list of questions to display. */
app.post('/fetchqlist', function(req, res) {
    var type = common.sortTypes.SORT_RANDOM;
    var ans = false;

    if (req.body.type == 'answered') {
        type |= common.sortTypes.QUERY_ANSWERED | common.sortTypes.QUERY_ANSONLY;
        ans = true;
    }

    questions.findQuestions(10, type, req.session.user, function(results) {
        req.session.questions = results;
        req.session.answeredQuestions = ans;
        var html = questionList({
            questions: results
        });
        res.status(200).send(html);
    });
});

/* Sort question list by specified criterion and send new HTML. */
app.post('/sortlist', function(req, res) {
    var type;

    for (type in common.sortTypes) {
        if (req.body.sort == common.sortTypes[type])
            break;
    }

    questions.sortQuestions(req.session.questions, common.sortTypes[type],
        function(results) {
          var html = questionList({
              questions: results
          });
          res.status(200).send(html);
        }
    );
});

/* User requests a question; look it up by ID and store it in session. */
app.post('/questionreq', function(req, res) {
    questions.lookupQuestionById(parseInt(req.body.id), function(result) {
        if (result == 'failure' || result == 'invalid') {
            res.status(500).send();
        } else {
            req.session.question = result;
            if (req.session.user.answered.indexOf(result.id) == -1)
                req.session.questionAnswered = false;
            else
                req.session.questionAnswered = true;
            res.status(200).send();
        }
    });
});

/* check if the submitted answer is correct */
app.post('/submitanswer', function(req, res) {
    questions.checkAnswer(
        req.session.question.id,
        req.session.user.id,
        req.body.answer,
        function(result) {
            var data = {};

            result = result ? 'correct' : 'incorrect';
            data.result = result;
            if (result == 'failed-update') {
                res.status(500).send(data);
            } else if (result == 'correct') {
                data.points = req.session.question.points;
                /* remove question from questions list, TODO: fetch new one */
                for (var ind in req.session.questions) {
                    if (req.session.questions[ind].id == req.session.question.id)
                        break;
                }
                req.session.questions.splice(ind, 1);
                req.session.questionAnswered = true;
            } else {
                /* TODO: reload sidebar stats, save in data.html */
            }
            res.status(200).send(data);
        }
    );
});

/*
 * Create a new user.
 * The request body contains an incomplete student object with attributes
 * from the fields in the user creation form.
 * If the user ID already exists, creation fails.
 * Otherwise, the user is inserted into the database and added
 * to the active admin student list.
 */
app.post('/useradd', function(req, res) {
    users.addStudent(req.body, function(result) {
        if (result == 'failure') {
            res.status(500);
        } else if (result == 'exists') {
            res.status(200);
        } else {
            if (req.session.adminStudentList != null)
                req.session.adminStudentList.push(req.body);
            res.status(200);
        }
        res.send(result);
    });
});

/*
 * Delete a user with from the database.
 * The request body is an object with a single 'userid' field,
 * containing the ID of the user to be deleted.
 */
app.post('/userdel', function(req, res) {
    students.deleteAccount(req.body.userid, function(result) {
        if (result == 'failure') {
            res.status(500);
        } else {
            if (req.session.adminStudentList != null) {
                /* Remove the deleted user from the stored student list. */
                var ind;
                for (ind in req.session.adminStudentList) {
                    if (req.session.adminStudentList[ind].id == req.body.userid)
                        break;
                }
                req.session.adminStudentList.splice(ind, 1);
            }
            res.status(200);
        }
        res.send();
    });
});

/*
 * Modify a user object in the database.
 * The request body contains a user object with the fields to be modified.
 */
app.post('/usermod', function(req, res) {
    var userId = req.body.originalID;
    var updateId = req.body.id;

    users.updateStudentById(userId, req.body, function(result) {
        users.getStudentById(updateId, function(userFound){
            var html = accountEdit({
                user: userFound,
                cdate: creationDate(userFound.ctime)
            });
            res.status(200).send({
                result: result,
                html: html
            });
        });
    });
});

/*
 * Upload a csv file containing account information.
 * Users are stored in the database.
 */
app.post('/userupload', upload.single('usercsv'), function(req, res) {
    if (!req.file || req.file.mimetype != 'text/csv')
        res.status(200).send('invalid');

    students.parseFile(req.file.path, function(account) {
        refetch = true;
    }, function() {
        res.status(200).send('uploaded');
    });
});

/*
 * Add a question to the database.
 * The request body contains the question to be added.
 */
app.post('/questionadd', function(req, res) {
    questions.addQuestionByTypeWithRedirection(req.body.type, req.body, function(result) {
        if (result == 'failure') {
            res.status(500);
        } else {
            res.status(200);
            req.session.adminQuestionList.push(req.body);
        }
        res.send(result);
    });
});

/*
 * Modify a question in the database.
 * Request body contains question's ID and a question object with
 * the fields to be changed.
 */
app.post('/questionmod', function(req, res) {
    var qid = parseInt(req.body.id);
    var q = req.body.question;

    questions.updateQuestionByIdWithRedirection(qid, q, function(result) {
        res.status(200).send(result);
    });
});

/*
 * Remove a question from the database.
 * The request body contains the ID of the question to delete.
 */
app.post('/questiondel', function(req, res) {
    var qid = parseInt(req.body.qid);
    questions.deleteQuestion(qid, function(result) {
        if (result == 'failure') {
            res.status(500);
        } else {
            if (req.session.adminQuestionList != null) {
                /* Remove the deleted question from the stored question list. */
                var ind;
                for (ind in req.session.adminQuestionList) {
                    if (req.session.adminQuestionList[ind].id == qid)
                        break;
                }
                req.session.adminQuestionList.splice(ind, 1);
            }
            res.status(200);
        }
        res.send();
    });
});

/* Respond with question page HTML for a dummy user. */
app.get('/questionpreview', function(req, res) {
    if (!req.query.qid) {
        res.status(400).send();
        return;
    }

    var qid = parseInt(req.query.qid);
    questions.lookupQuestionById(qid, function(q) {
        if (q == 'invalid' || q == 'failure') {
            res.status(200).send(q);
            return
        }

        res.render('question', {
            user: 'Username',
            question: q,
            answered: false,
            preview: true
        });
    });
});

db.initialize(function() {
    log.init(function() {
        app.listen(port, function() {
            logger.info('Server listening on http://localhost:%s.', port);
        });
    });
});
